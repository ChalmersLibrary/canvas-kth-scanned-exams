import "./config";
import fs from "fs";
import https from "https";
import log from "skog";
import server from "./server";

import { startBackgroundImport } from "./importWorker";

const serverUrl = new URL(process.env.SERVER_HOST_URL);
const hostname = serverUrl.host.split(":")[0];

function startApiServer(sslCerts) {
  startBackgroundImport();

  https.createServer(sslCerts, server).listen(process.env.PORT || 4443, () => {
    log.info(
      `Started HTTPS server in https://localhost:${process.env.PORT || 4443}`
    );
  });
}

try {
  const sslCerts = {
    key: fs.readFileSync("certs/key.pem"),
    cert: fs.readFileSync("certs/server.crt"),
  };
  startApiServer(sslCerts);
} catch (err) {
  if (process.env.NODE_ENV === "production") throw err;

  // DEVELOPMENT SERVER
  /* eslint import/no-extraneous-dependencies: ["error", {"devDependencies": true}] */
  const devcert = require("devcert");
  devcert
    .certificateFor(hostname, {
      skipHostsFile: true, // Don't modify /etc/hosts
      skipCertutil: true, // This option will tell devcert to avoid installing certutil tooling.
    })
    .then((sslCert) => {
      startApiServer(sslCert);
    });
}
