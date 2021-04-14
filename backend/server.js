require("dotenv").config();
const log = require("skog");

log.init.pino({
  app: "scanned-exams",
});

process.on("uncaughtException", (err) => {
  log.fatal(err, `Reject: ${err}`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  log.fatal(reason, `Reject: ${reason}`);
  process.exit(1);
});

require("@kth/reqvars").check();

const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const apiRouter = require("./api/router");
const authRouter = require("./auth/router");
const monitor = require("./monitor");
const fs = require("fs/promises");

const PORT = 4000;
const server = express();

server.use(log.middleware);
server.use(express.urlencoded());
server.use(cookieParser());

// Routes:
// - /           The welcome page
// - /api        API routes (only for authorized people)
// - /app        The React application (including all frontend artifacts
//               like CSS files)
// - /auth       routes for the authorization process
// - /_monitor   just the monitor page
server.post("/scanned-exams", async (req, res) => {
  log.info("Enter /");
  const html = await fs.readFile("index.html", { encoding: "utf-8" });

  res
    .cookie("scanned-exams-example", "hello!", {
      secure: true,
      domain: "kth.se",
    })
    .status(200)
    .send(
      html
        .replace("{{COURSE_ID}}", req.body.custom_courseid)
        .replace("{{DOMAIN}}", req.body.custom_domain)
    );
});
server.get("/scanned-exams", (req, res) => {
  log.info("Enter /");
  res.status(200).send("Yay");
});
server.use("/scanned-exams/auth", authRouter);
server.use("/scanned-exams/api", apiRouter);
server.use(
  "/scanned-exams/app",
  express.static(path.join(__dirname, "..", "frontend", "build"))
);
server.get("/scanned-exams/_monitor", monitor);
module.exports = server;

server.listen(PORT, () => {
  log.info(`App listening on port ${PORT}`);
});
