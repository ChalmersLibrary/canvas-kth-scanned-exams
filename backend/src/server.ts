import log from "skog";
import express from "express";
import cookieParser from "cookie-parser";
import session from "express-session";
import path from "path";
import fs from "fs";
import connectMongodbSession from "connect-mongodb-session";

import apiRouter from "./api/router";
import authRouter from "./auth/router";
import monitor from "./monitor";

const MongoDBStore = connectMongodbSession(session);
const server = express();

const COOKIE_MAX_AGE_SECONDS = 3600;
const store = new MongoDBStore({
  uri: process.env.MONGODB_CONNECTION_STRING,
  collection: "sessions",

  // Session expiration time
  expires: COOKIE_MAX_AGE_SECONDS * 1000,

  // These two lines are required when using CosmosDB
  // See https://github.com/mongodb-js/connect-mongodb-session#azure-cosmos-mongodb-support
  expiresKey: `_ts`,
  expiresAfterSeconds: COOKIE_MAX_AGE_SECONDS,
});

server.set("trust proxy", 1);
server.use(
  session({
    name: "scanned-exams.sid",
    cookie: {
      // domain: "localhost",
      maxAge: COOKIE_MAX_AGE_SECONDS * 1000,
      secure: true,
      sameSite: "none",
    },
    // MongoDB does not update TTL when reading but when writing
    resave: true,

    // Avoid saving anonymous sessions (non logged-in users)
    saveUninitialized: false,
    secret: process.env.SESSION_SECRET,
    store,
  })
);

log.level = "debug";

server.use(log.middleware);
server.use((req, res, next) => {
  // Get courseId from path if available
  const courseId = req.path.startsWith("/scanned-exams/api/courses")
    ? req.path.split("/")[4]
    : undefined;
  log.child(
    {
      session_id: req.session.id.slice(0, 6),
      course_id: courseId,
    },
    next
  );
});
server.use(express.urlencoded({ extended: true }));
server.use(express.json());
server.use(cookieParser());

// Routes:
// - /           The welcome page
// - /api        API routes (only for authorized people)
// - /app        The React application (including all frontend artifacts
//               like CSS files)
// - /auth       routes for the authorization process
// - /_monitor   just the monitor page
function _showOnlyHostname(inp: string): string {
  const tmpIn = inp.startsWith("http") ? inp : `https://${inp}`;
  const tmpOut = tmpIn.match(/https?:\/\/[^\/]*/m);
  if (tmpOut != null) {
    return tmpOut[0];
  } else {
    return null;
  }
}
server.post("/scanned-exams", async (req, res) => {
  try {
    /*const domain = req.body.custom_domain;
    const courseId = req.body.custom_courseid;*/
    const domain = req.body.custom_canvas_api_domain;
    const courseId = req.body.custom_canvas_course_id;

    // TODO: if domain is kth.test.instructure.com > Redirect to the app in referens
    // TODO: if domain is kth.instructure.com > Show a message encouraging people to use "canvas.kth.se"
    // TODO: set a cookie to check from client-side JS that the cookie is set correctly

    if (req.session.userId) {
      log.debug("POST /scanned-exams: user has a session. Redirecting to /app");
      return res.redirect(`/scanned-exams/app?courseId=${courseId}`);
    }

    log.debug(
      `POST /scanned-exams: user has launched the app from course ${courseId}`
    );

    if (!process.env.CANVAS_API_URL.startsWith(`https://${domain}`)) {
      const msg = `This app is configured for ${_showOnlyHostname(
        process.env.CANVAS_API_URL
      )} but you are running it from ${_showOnlyHostname(
        domain
      )}. Please update your bookmarks, ${_showOnlyHostname(
        process.env.CANVAS_API_URL
      )} is the URL that should be used!`;
      log.warn(msg);

      return res.status(400).send(msg);
    }

    req.session.userId = null;

    return res.redirect(`/scanned-exams/app?courseId=${courseId}`);
  } catch (err) {
    log.error({ err });
    return res.status(500).send("Unknown error. Please contact IT support");
  }
});
server.use("/scanned-exams/auth", authRouter);
server.use("/scanned-exams/api", apiRouter); // NOTE: If you change this route mapping, please update the logging middleware
server.get("/scanned-exams/app", async (req, res) => {
  try {
    const html = await fs.promises.readFile(
      path.join(__dirname, "..", "..", "frontend", "build", "index.html"),
      { encoding: "utf-8" }
    );

    return res.send(html);
  } catch (err) {
    log.error(err);
    return res.status(500).send("Unknown error. Please contact IT support");
  }
});
server.use(
  "/scanned-exams/app/static",
  express.static(
    path.join(__dirname, "..", "..", "frontend", "build", "static")
  )
);

server.get("/scanned-exams/_monitor", monitor);

export default server;
