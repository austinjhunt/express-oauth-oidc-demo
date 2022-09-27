/*
Austin Hunt
September 26, 2022
OIDC Demo
The goal of this SimpleOIDCDemo class is to demonstrate the OpenID Connect Authorization flow
against a Google Cloud Platform application created with very restricted read-only scopes.
Google's OAuth 2.0 APIs can be used for both authentication and authorization. This document
https://developers.google.com/identity/protocols/oauth2/openid-connect describes Google's
OAuth 2.0 implementation for authentication, which conforms to the OpenID Connect specification, and is OpenID Certified. \
When run, the user should be prompted with a Google login screen, and after authenticating (perhaps with MFA),
they should see a consent screen for an app titled OpenID Connect Authorization Flow Demonstration, which
requests access to:
NONSENSITIVE: See your primary Google Account email address
NONSENSITIVE: See your personal info, including any personal info you've made publicly available
SENSITIVE: See information about your Google Drive files.

If approved / granted, the OIDC flow will complete and display some basic information about the content of the user's drive account.

This follows the official Google OIDC implementation documentation found here:
https://developers.google.com/identity/protocols/oauth2/openid-connect#python

*/
const express = require("express");
const ejs = require("ejs"); // use EJS template engine for rendering context
const sessions = require("express-session");
const path = require("path");
const config = require("./config").config;
const app = express();
app.set("view engine", "ejs");
const port = 8080;

const scopes = [
  "openid profile",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
];

let getRandomValue = (length) => {
  var result = "";
  var characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var charactersLength = characters.length;
  for (var i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
};

let serialize = (obj) => {
  // convert an object to a string of concatenated query parameters
  var str = [];
  for (var p in obj)
    if (obj.hasOwnProperty(p)) {
      str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
    }
  return str.join("&");
};

// use session, specifically for state comparison
app.use(
  sessions({
    secret: getRandomValue(24),
    saveUninitialized: true,
    resave: false,
  })
);
// allow use of CSS file
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.render("index");
});

let getFiles = async (req, res) => {
  let files = await fetch(`https://www.googleapis.com/drive/v3/files`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${req.session.access_token}`,
      Accept: "application/json",
    },
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.error) {
        return refreshAccessToken(req, res).then(getFiles(req, res));
      } else {
        return data.files;
      }
    });
  return files;
};

app.get("/start-flow", (req, res) => {
  let state = getRandomValue(24);
  req.session.state = state;
  let full_auth_url =
    `${config.auth_uri}?` +
    serialize({
      response_type: "code", // should always be code for basic auth code flow
      client_id: config.client_id,
      access_type: "offline", // allow refresh token
      scope: scopes.join(" "),
      redirect_uri: config.redirect_uris[0],
      state: req.session.state,
      nonce: getRandomValue(24), // random value for replay protection
    });
  res.redirect(full_auth_url);
});

let refreshAccessToken = async (req, res) => {
  // exchange auth code for access token
  await fetch(config.token_uri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: serialize({
      client_id: config.client_id,
      client_secret: config.client_secret,
      refresh_token: req.session.refresh_token,
      grant_type: "refresh_token",
    }),
  })
    .then((response) => response.json())
    .then((data) => {
      console.log("refresh response");
      console.log(data);
      req.session.access_token = data.access_token;
      req.session.scope = data.scope;
      req.session.expires_in = data.expires_in;
    });
};

let exchangeAuthCodeForAccessToken = async (req, res) => {
  // exchange auth code for access token
  await fetch(config.token_uri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: serialize({
      code: req.query.code,
      client_id: config.client_id,
      client_secret: config.client_secret,
      redirect_uri: config.redirect_uris[0],
      grant_type: "authorization_code",
    }),
  })
    .then((response) => response.json())
    .then((data) => {
      req.session.id_token = data.id_token;
      req.session.access_token = data.access_token;
      req.session.refresh_token = data.refresh_token;
      req.session.scope = data.scope;
      req.session.expires_in = data.expires_in;
    });
};

app.get("/redirect_uri", (req, res) => {
  // redirect URI configured on GCP to which
  // auth endpoint response is sent after user consents
  // verify that state in query param matches session state generated before
  // sending user to auth endpoint
  if (req.query.state === req.session.state) {
    console.log("state matches");
    req.session.authorized = true;
    exchangeAuthCodeForAccessToken(req, res).then(() => {
      fetch("https://www.googleapis.com/drive/v3/about?fields=user", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${req.session.access_token}`,
          Accept: "application/json",
        },
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.user) {
            console.log(data.user.emailAddress);
            req.session.user = data.user;
            req.session.emailAddress = data.user.emailAddress;
            req.session.photoLink = data.user.photoLink;
            req.session.displayName = data.user.displayName;
          }
        })
        .then(() => {
          res.render("index", {
            authorized: req.session.authorized,
            emailAddress: req.session.emailAddress,
            photoLink: req.session.photoLink,
            displayName: req.session.displayName,
          });
        });
    });
  } else {
    console.log(`Returned state  does not match session state `);
    res.redirect("/start-flow");
  }
});

app.get("/get-files", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  getFiles(req, res).then((data) => res.end(JSON.stringify(data)));
});

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});
