import log from "skog";
import JsonBig from "json-bigint";
import * as canvasApi from "../externalApis/canvasApiClient";
import * as tentaApi from "../externalApis/tentaApiClient";
import {
  getFirstPendingFromQueue,
  updateStatusOfEntryInQueue,
  updateStudentOfEntryInQueue,
} from "./index";
import * as courseStudents from "../../courseStudents";
import { ImportError } from "../error";

const { DEV_FORCE_RANDOM_ERRORS, NODE_ENV } = process.env;
const FORCE_RANDOM_ERRORS = DEV_FORCE_RANDOM_ERRORS === "TRUE";
const IS_DEV = NODE_ENV !== "production";

/**
 * Students that don't exist in UG get a fake personnummer
 * in windream and they need to be graded manually
 */
function throwIfStudentNotInUg({ fileId, fileName, studentPersNr }) {
  if (studentPersNr.replace(/-/g, "") === "121212121212") {
    throw new ImportError({
      type: "not_in_ug",
      message: `The student does not have a Canvas account. Please contact IT-support (windream fileId: ${fileId}, ${fileName}) - Unhandled error`,
    });
  }
}

/**
 * Students has missing entry for User ID, probably external
 * and needs to be manually graded
 */
function throwIfStudentMissingUserId({ fileId, fileName, studentUserId }) {
  if (!studentUserId) {
    throw new ImportError({
      type: "missing_kthid",
      message: `The scanned exam is missing Canvas User Id. Please contact IT-support (windream fileId: ${fileId}, ${fileName}) - Unhandled error`,
    });
  }
}

async function uploadOneExam({ fileId, courseId }) {
  log.debug(`Course ${courseId} / File ${fileId}. Downloading`);
  
  const { content, fileName, student, examDate } = await tentaApi.downloadExam(fileId);

  let courseUsers;
  let courseUsersCache;
  let courseUser;

  try {
    courseUsersCache = await courseStudents.getCourseStudents(courseId);   
    courseUsers = JsonBig.parse(courseUsersCache.students);
  }
  catch (error) {
    log.error("No students found in MongoDB cache for course.");

    const courseUsersResponse = await canvasApi.getCanvasStudentsInCourse(courseId);
    courseUsers = courseUsersResponse.students;

    log.debug(`Found [${courseUsersResponse.students.length}] students in Canvas course [${courseId}], adding to cache.`);

    courseUsersCache = {
      courseId: courseId,
      students: courseUsersResponse.rawResponse
    };

    await courseStudents.addEntry(courseUsersCache);

    log.debug("Added entry to MongoDB cache for course.");
    log.debug(courseUsersCache);
  }

  if (!courseUsers) {
    log.error("Could not find course students!");
  }

  log.debug("Searching enrolled students for " + student.userId + (!student.userId?.includes("@") ? "@chalmers.se" : ""));
  courseUser = courseUsers.find(u => u.login_id == student.userId + (!student.userId?.includes("@") ? "@chalmers.se" : ""));

  if (!courseUser) {
    log.debug("Searching enrolled students for " + student.personNumber);
    courseUser = courseUsers.find(u => u.sis_user_id == student.personNumber);
  }

  if (courseUser) {
    if (courseUser.login_id.split("@")[0] != student.userId) {
      log.info(`Student id from Aldoc: [${student.userId}] is translated to student id in Canvas: [${courseUser.login_id.split("@")[0]}]`);
      student.userId = courseUser.login_id.split("@")[0];
    }

    student.canvasInternalId = courseUser.id;

    log.info(`Student userId ${student.userId} internal id ${student.canvasInternalId} anonymous code ${student.anonymousCode ? student.anonymousCode : "-"} ${student.firstName} ${student.lastName}`);
  }
  else {
    log.error(`Student [${student.firstName} ${student.lastName}] not found in course [${courseId}], searched for [${student.userId + (!student.userId?.includes("@") ? "@chalmers.se" : "")}] and [${student.personNumber}].`)
  }

  // Some business rules
  throwIfStudentMissingUserId({ fileId, fileName, studentUserId: student.canvasInternalId });
  throwIfStudentNotInUg({
    fileId,
    fileName,
    studentPersNr: student.personNumber,
  });

  await updateStudentOfEntryInQueue({ fileId }, student);

  log.debug(
    `Course ${courseId} / File ${fileId}, ${fileName} / User ${student.userId} id ${student.canvasInternalId}. Uploading`
  );
  const uploadExamStart = Date.now();
  const submissionTimestamp = await canvasApi.uploadExam(content, {
    courseId,
    studentUserId: student.userId,
    studentCanvasInternalId: student.canvasInternalId,
    studentAnonymousCode: student.anonymousCode,
    examDate,
    fileId,
  });
  log.debug("Time to upload exam: " + (Date.now() - uploadExamStart) + "ms");

  log.info(
    `Course ${courseId} / File ${fileId}, ${fileName} / User ${student.userId}. Uploaded! Timestamp @ ${submissionTimestamp}`
  );
}

function handleUploadErrors(err, exam) {
  if (err instanceof ImportError) {
    if (err.type === "import_error") {
      // This is a general error which means we don't know
      // how to fix it from code.
      log.error(
        "Unhandled Canvas Error - we failed uploading exam " +
          exam.fileId +
          ` (${err.type || err.name} | ${err.message})`
      );
    }
    // ImportErrors already have a good error message
    // so we just throw them as is
    throw err;
  } else {
    // This error was probably caused by our code
    log.error(
      { err },
      "Unhandled Import Error - we failed uploading exam " +
        exam.fileId +
        ` (${err.message})`
    );

    // We need to create a user friendly error message that is stored in the
    // import queue
    throw new ImportError({
      type: "other_error",
      message: `We encountered an unhandled error when importing exam (windream fileId: ${exam.fileId}) - Unhandled error`,
      details: {
        err,
        exam,
      },
    });
  }
}

/**
 * Find and process an entry from the global import queue and exit
 * @returns {bool} return true is entry was processed and false if queue was empty
 */
export async function processQueueEntry() {
  const examToBeImported = await getFirstPendingFromQueue();

  if (examToBeImported) {
    // Log the courseId for this operation
    try {
      // Force errors during development
      if (IS_DEV && FORCE_RANDOM_ERRORS) {
        if (Math.random() > 0.8)
          throw Error("Forced error for testing during development");
      }

      // Upload to Canvas
      await log
        .child({ courseId: examToBeImported?.courseId }, () =>
          uploadOneExam({
            fileId: examToBeImported.fileId,
            courseId: examToBeImported.courseId,
          })
        )
        .catch((err) => {
          handleUploadErrors(err, examToBeImported);
        });

      // Update status in import queue
      await updateStatusOfEntryInQueue(examToBeImported, "imported");

      if (IS_DEV) log.debug("Imported file " + examToBeImported.fileId);
    } catch (err) {
      // TODO: Improve handling of errors, at least adding a more user
      // friendly message
      await updateStatusOfEntryInQueue(examToBeImported, "error", {
        type: err.type || err.name,
        message: err.message,
        details: err.details || {},
      });
    }
  }

  return !!examToBeImported;
}
