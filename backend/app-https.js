const fs = require("fs");
const https = require("https");
const log = require("skog");
const server = require("./server");

const { startBackgroundImport } = require("./importWorker");
const { startDatabaseConnection } = require("./api/importQueue");

const privateKey = fs.readFileSync("certs/key.pem");
const certificate = fs.readFileSync("certs/cert.pem");

server.listen(4000, async () => {
  log.info(`Started HTTP server in http://localhost:4000`);
  await startDatabaseConnection();
  startBackgroundImport();
});

const httpsServer = https.createServer(
  {
    key: privateKey,
    cert: certificate,
  },
  server
);

httpsServer.listen(process.env.PORT || 4443, () => {
  log.info(
    `Started HTTPS server in https://localhost:${process.env.PORT || 4443}`
  );
});
