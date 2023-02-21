/** Endpoints to setup a Canvas course */

import * as canvasApi from "../externalApis/canvasApiClient";
import { CanvasApiError, EndpointError } from "../error";

/**
 * Get the "ladokId" of a given course. It throws in case the course
 * has no valid ladok IDs
 */
function throwIfNotExactlyOneLadokId(ladokIds, courseId) {
  if (!Array.isArray(ladokIds) || ladokIds.length !== 1) {
    throw new EndpointError({
      type: "invalid_course",
      statusCode: 409, // Conflict - Indicates that the request could not be processed because of conflict in the current state of the resource
      message: "Examrooms with more than one examination are not supported",
      details: {
        courseId,
        ladokIds,
      },
    });
  }
}

/** Get setup status of a Canvas course given its ID */
async function getSetupStatus(req, res, next) {
  try {
    const courseId = req.params.id;

    const ladokIds = await canvasApi.getAktivitetstillfalleUIDs(courseId);
    // TODO: Chalmers can have two different, if it's a joint exam room with CTH and GU...
    throwIfNotExactlyOneLadokId(ladokIds, courseId);
    const ladokId = ladokIds[0];

    const [course, assignment] = await Promise.all([
      canvasApi.getCourse(courseId),
      canvasApi.getValidAssignment(courseId, ladokId),
    ]);

    res.send({
      coursePublished: course.workflow_state === "available",
      assignmentCreated: assignment != null,
      assignmentPublished: assignment?.published || false,
    });
  } catch (err) {
    next(err);
  }
}

/** Create a homepage in Canvas */
async function createSpecialHomepage(req, res, next) {
  try {
    await canvasApi.createHomepage(req.params.id);

    res.send({
      message: "done",
    });
  } catch (err) {
    next(err);
  }
}

/** Publish a Canvas course given its ID */
async function publishCourse(req, res, next) {
  try {
    const courseId = req.params.id;
    await canvasApi.publishCourse(courseId);

    res.send({
      message: "done",
    });
  } catch (err) {
    next(err);
  }
}

/** Creates a special assignment in a given course */
async function createSpecialAssignment(req, res, next) {
  try {
    const courseId = req.params.id;

    const ladokIds = await canvasApi.getAktivitetstillfalleUIDs(courseId);
    throwIfNotExactlyOneLadokId(ladokIds, courseId);
    const ladokId = ladokIds[0];

    const existingAssignment = await canvasApi.getValidAssignment(
      courseId,
      ladokId
    );

    if (existingAssignment) {
      throw new CanvasApiError({
        type: "assignment_exists",
        statusCode: 409, // Conflict - Indicates that the request could not be processed because of conflict in the current state of the resource
        message: "The assignment already exists",
      });
    }

    await canvasApi.createAssignment(courseId, ladokId);
    res.send({
      message: "done",
    });
  } catch (err) {
    next(err);
  }
}

/** Publish the special assignment in Canvas */
async function publishSpecialAssignment(req, res, next) {
  try {
    const courseId = req.params.id;

    const ladokIds = await canvasApi.getAktivitetstillfalleUIDs(courseId);
    throwIfNotExactlyOneLadokId(ladokIds, courseId);
    const ladokId = ladokIds[0];

    const assignment = await canvasApi.getValidAssignment(courseId, ladokId);

    if (!assignment) {
      throw new CanvasApiError({
        type: "assignment_not_found",
        statusCode: 404,
        message: "There is no valid assignment that can be published",
      });
    }

    await canvasApi.publishAssignment(courseId, assignment.id);

    res.send({
      message: "done",
    });
  } catch (err) {
    next(err);
  }
}

export {
  throwIfNotExactlyOneLadokId as _throwIfNotExactlyOneLadokId,
  getSetupStatus,
  createSpecialHomepage,
  publishCourse,
  createSpecialAssignment,
  publishSpecialAssignment,
};
