const log = require("skog");
const canvas = require("./canvasApiClient");

async function checkAuthorization(req, res, next) {
  const { id: courseId } = req.params;
  const { userId } = req.session;
  const { roles, authorized } = await canvas.getAuthorizationData(
    courseId,
    userId
  );

  if (authorized) {
    log.debug(`Authorized. User ${userId} in Course ${courseId}.`);

    return next();
  }

  log.warn(
    `Not authorized. User ${userId} in Course ${courseId} has roles: [${roles}].`
  );

  return res.status(401).send({
    message: "Unauthorized: you must be teacher or examiner to use this app",
  });
}

module.exports = {
  checkAuthorization,
};
