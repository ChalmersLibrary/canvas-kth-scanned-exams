const log = require("skog");

log.init.pino({
  app: "scannade-tentor",
});

const express = require("express");
const path = require("path");
const apiRouter = require("./api/router");

const PORT = 4000;
const server = express();

server.use(log.middleware);

// Routes:
// - /           The welcome page
// - /api        API routes (only for authorized people)
// - /app        The React application (including all frontend artifacts
//               like CSS files)
// - /auth       routes for the authorization process
// - /_monitor   just the monitor page
server.get("/scanned-exams", (req, res) => {
  log.info("Enter /");
  res.status(200).send("Yay");
});
// server.get("/scanned-exams/api", apiRouter);
server.use(
  "/scanned-exams/app",
  express.static(path.join(__dirname, "..", "frontend", "build"))
);
server.get("/scanned-exams/_monitor", (req, res) => {
  res.send("APPLICATION_STATUS: OK");
});

server.listen(PORT, () => {
  log.info(`App listening on port ${PORT}`);
});
