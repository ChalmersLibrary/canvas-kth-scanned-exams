const express = require("express");
const log = require("skog");
const { errorHandler, EndpointError } = require("./error");

const { checkPermissionsMiddleware } = require("./permission");
const {
  getStatusFromQueue,
  addEntryToQueue,
  resetQueueForImport,
  updateStatusOfEntryInQueue,
} = require("./importQueue");
const {
  getSetupStatus,
  createSpecialHomepage,
  publishCourse,
  createSpecialAssignment,
  publishSpecialAssignment,
} = require("./setupCourse");
const { listAllExams } = require("./listAllExams");

const IS_DEV = process.env.NODE_ENV !== "production";

const router = express.Router();

router.use("/courses/:id", checkPermissionsMiddleware);

/**
 * Returns data from the logged in user.
 * - Returns a 404 if the user is not logged in
 */
router.get("/me", (req, res) => {
  const { userId } = req.session;

  if (!userId) {
    log.info("Getting user information. User is logged out");
    return res.status(404).send({ message: "You are logged out" });
  }

  log.info("Getting user information. User is logged in");
  return res.status(200).send({ userId });
});

router.get("/courses/:id/setup", async (req, res, next) => {
  try {
    const status = await getSetupStatus(req.params.id);
    res.send(status);
  } catch (err) {
    next(err);
  }
});

router.post("/courses/:id/setup/create-homepage", async (req, res, next) => {
  try {
    await createSpecialHomepage(req.params.id);

    res.send({
      message: "done!",
    });
  } catch (err) {
    next(err);
  }
});

router.post("/courses/:id/setup/publish-course", async (req, res, next) => {
  try {
    await publishCourse(req.params.id);

    res.send({
      message: "done!",
    });
  } catch (err) {
    next(err);
  }
});

router.post("/courses/:id/setup/create-assignment", async (req, res, next) => {
  try {
    await createSpecialAssignment(req.params.id);

    return res.send({
      message: "done!",
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/courses/:id/setup/publish-assignment", async (req, res, next) => {
  try {
    await publishSpecialAssignment(req.params.id);

    return res.send({
      message: "done!",
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * return the list of exams
 * - Canvas is source of truth regarding if a submitted exam is truly imported
 * - the internal import queue keeps state of pending and last performed import
 */
router.get("/courses/:id/exams", async (req, res, next) => {
  try {
    const { result, summary } = await listAllExams(req.params.id);

    return res.send({
      result,
      summary,
    });
  } catch (err) {
    return next(err);
  }
});

// Get the import process status
router.get("/courses/:id/import/status", async (req, res) => {
  const courseId = req.params.id;
  const status = await getStatusFromQueue(courseId);

  res.send(status);
});

// Start the import process
router.post(
  "/courses/:id/import/start",
  express.json(),
  async (req, res, next) => {
    const courseId = req.params.id;
    const { status } = await getStatusFromQueue(courseId);

    if (!Array.isArray(req.body)) {
      return next(
        new EndpointError({
          type: "missing_body",
          message: "This endpoint expects to get a list of fileIds to import",
          statusCode: 400, // Bad Request
        })
      );
    }

    if (status !== "idle") {
      return next(
        new EndpointError({
          type: "queue_not_idle",
          message:
            "Can't start new import if the queue for this course is working",
          statusCode: 409, // Conflict - Indicates that the request could not be processed because of conflict in the current state of the resource
        })
      );
    }

    await resetQueueForImport(courseId);

    for (const fileId of req.body) {
      // eslint-disable-next-line no-await-in-loop
      await addEntryToQueue({
        fileId,
        courseId,
        status: "pending",
      })
        // eslint-disable-next-line no-await-in-loop
        .catch(async (err) => {
          if (
            err.message.startsWith(
              "Add to queue failed becuase entry exist for this fileId"
            )
          ) {
            // We get an error if it already exists so setting it to pending
            await updateStatusOfEntryInQueue(
              {
                fileId,
              },
              "pending"
            );
          }
        });
      if (IS_DEV && Math.random() > 0.7) {
        // eslint-disable-next-line no-await-in-loop
        await updateStatusOfEntryInQueue(
          {
            fileId,
          },
          "error",
          {
            type: "test_import_error",
            message: "Forcing errors on import to test queue",
          }
        );
        log.debug("Forced fill to get state 'error'.");
      }
    }

    // Return the queue status object so stats can be updated
    // in frontend
    const statusObj = await getStatusFromQueue(courseId);
    return res.status(200).send(statusObj);
  }
);

router.use(errorHandler);
module.exports = router;
