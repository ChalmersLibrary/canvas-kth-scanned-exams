/** Functions that handle the "import exams" part of the app */
import log from "skog";
import * as canvasApi from "../externalApis/canvasApiClient";
import * as tentaApi from "../externalApis/tentaApiClient";
import { getEntriesFromQueue } from "../importQueue";
import { CanvasApiError, EndpointError } from "../error";

/**
 * Get the "ladokId" that is associated with a given course. It throws in case
 * the course is not a valid "exam room"
 *
 * Note: this function does not check if the returned ladok ID exists in Ladok.
 */
function throwIfNotExactlyOneLadokId(ladokIds, courseId) {
  if (!Array.isArray(ladokIds) || ladokIds.length !== 1) {
    throw new EndpointError({
      type: "invalid_course",
      statusCode: 409, // Conflict - Indicates that the request could not be processed because of conflict in the current state of the resource
      message: "Only examrooms with exactly one (1) examination is supported",
      details: {
        courseId,
        ladokIds,
      },
    });
  }
}

/** Returns a list of scanned exams (i.e. in Windream) given its ladokId
 * 
 * Chalmers: If no scanned exams are found, also try searching with "<LadokUUID>_CTH" and "<LadokUUID>_GU".
 * There could be CTH+GU exam rooms, where the UUIDs are different in different sections. This is not supported
 * (yet) in this application.
 */
async function listScannedExams(courseId, ladokId) {
  let searchKeys = [];
  searchKeys.push(ladokId);

  if (process.env.TENTA_API_LADOKID_ADDITIONAL_SUFFIXES) {
    for (const suffix of process.env.TENTA_API_LADOKID_ADDITIONAL_SUFFIXES.split(",")) {
      searchKeys.push(ladokId + suffix);
    }
  }

  let allScannedExams = [];
  
  for (const key of searchKeys) {
    if (allScannedExams.length == 0) {
      allScannedExams = await tentaApi.examListByLadokId(key);

      log.info(
        `Exams for course [${courseId}] ladokId [${key}]: ${allScannedExams.length}`
      );
    }
  }

  return allScannedExams;
}

/**
 * Returns a list of students (KTH IDs) that has an exam in Canvas
 */
async function listStudentSubmissionsInCanvas(
  courseId,
  ladokId
): Promise<
  {
    submission_history: {
      attachments: {
        filename: string;
      }[];
    }[];
    user: {
      sis_user_id: string;
      login_id: string;
    };
  }[]
> {
  const assignment = await canvasApi
    .getValidAssignment(courseId, ladokId)
    .then((result) => {
      if (!result) {
        throw new CanvasApiError({
          type: "not_setup_course",
          statusCode: 409, // Conflict - Indicates that the request could not be processed because of conflict in the current state of the resource
          message: `The course [${courseId}] has no valid assignment for scanned exams. Probably is not setup correctly`,
          details: {
            courseId,
            ladokId,
          },
        });
      } else {
        return result;
      }
    });

  const submissions = await canvasApi.getAssignmentSubmissions(
    courseId,
    assignment.id
  );

  log.info(`listStudentSubmissionsInCanvas, courseId [${courseId}] ladokId [${ladokId}]`);

  return submissions;
}

function calcNewSummary(
  { ...summaryProps }: TErrorSummary,
  status: string,
  error: any
): TErrorSummary {
  const summary = { ...summaryProps };
  // eslint-disable-next-line no-param-reassign
  summary.total++;

  // eslint-disable-next-line no-param-reassign
  if (summary[status] === undefined) summary[status] = 0;
  // eslint-disable-next-line no-param-reassign
  summary[status]++;

  if (error) {
    const errorType = error.type as string;
    if (summary.errorsByType[errorType] === undefined) {
      // eslint-disable-next-line no-param-reassign
      summary.errorsByType[errorType] = 1;
    } else {
      // eslint-disable-next-line no-param-reassign
      summary.errorsByType[errorType]++;
    }
  }
  return summary;
}

type TErrorSummary = {
  total: number;
  new: number;
  pending: number;
  imported: number;
  error: number;
  errorsByType: { [key: string]: number }; // Typedef https://www.typescriptlang.org/docs/handbook/2/mapped-types.html
};

async function listAllExams(req, res, next) {
  try {
    const courseId = req.params.id;
    // - Canvas is source of truth regarding if a submitted exam is truly imported
    // - the internal import queue keeps state of pending and last performed import
    const ladokIds = await canvasApi.getAktivitetstillfalleUIDs(courseId);
    throwIfNotExactlyOneLadokId(ladokIds, courseId);
    const ladokId = ladokIds[0];

    let [allScannedExams, studentsWithSubmissionsInCanvas, examsInImportQueue] =
      await Promise.all([
        listScannedExams(courseId, ladokId),
        listStudentSubmissionsInCanvas(courseId, ladokId),
        getEntriesFromQueue(courseId),
      ]);

    // Make sure these are arrays
    allScannedExams = allScannedExams || [];
    studentsWithSubmissionsInCanvas = studentsWithSubmissionsInCanvas || [];
    examsInImportQueue = examsInImportQueue || [];

    // Fix missing userIds in scanned exams
    if (process.env.TENTA_API_QUERY_CANVAS_ON_MISSING_UID) {
      for (const exam of allScannedExams) {
        if (!exam.student.userId && exam.student.personNumber) {
          log.warn("(Listing all exams) Exam is missing student.userId, querying Canvas on student.personNumber");
    
          const user = await canvasApi.userDetails(exam.student.personNumber);
          log.info(user);

          if (process.env.CANVAS_USER_ID_KEY == "login_id") {
            if (process.env.CANVAS_USER_ID_KEY_CONTAINS_DOMAIN) {
              exam.student.userId = user.login_id.split("@")[0];
            } else {
              exam.student.userId = user.login_id;
            }
          } else {
            exam.student.userId = user.sis_user_id;
          }

          log.info(`(Listing all exams) student.userId mapped to [${exam.student.userId}]`);
        }
      }
    }

    let summary: TErrorSummary = {
      total: 0,
      new: 0,
      pending: 0,
      imported: 0,
      error: 0,
      errorsByType: {},
    };

    // Sort exams on createDate in ascending order
    allScannedExams.sort((a, b) => {
      if (a.createDate < b.createDate) {
        return -1;
      } else if (a.createDate > b.createDate) {
        return 1;
      } else {
        return 0;
      }
    });

    // Store all attachments in lookup dict for performance.
    // The key is a string and the object contains at least a filename.
    const attachmentsInCanvas: { [key: string]: { filename: string } } = {};
    studentsWithSubmissionsInCanvas.forEach((submission) =>
      submission.submission_history?.forEach((prevSubmission) => {
        prevSubmission.attachments?.forEach((attachment) => {
          // QUESTION: Should we warn if we have a duplicate upload?
          // NOTE: file_removed.pdf has the same name everywhere
          if (process.env.CANVAS_USER_ID_KEY == "login_id") {
            if (process.env.CANVAS_USER_ID_KEY_CONTAINS_DOMAIN) {
              attachmentsInCanvas[
                `${submission.user?.login_id.split("@")[0]}-${attachment.filename}`
              ] = attachment;  
            } else {
              attachmentsInCanvas[
                `${submission.user?.login_id}-${attachment.filename}`
              ] = attachment;  
            }
          } else {
            attachmentsInCanvas[
              `${submission.user?.sis_user_id}-${attachment.filename}`
            ] = attachment;
          }
        });
      })
    );

    const listOfExamsToHandle = allScannedExams.map((exam) => {
      const foundInCanvas =
        attachmentsInCanvas[`${exam.student?.userId}-${exam.fileId}.pdf`];

      const foundInQueue = examsInImportQueue.find(
        (examInQueue) => examInQueue.fileId === exam.fileId
      );

      let status = "new";
      let errorDetails;
      if (foundInCanvas) {
        status = "imported";
      } else if (foundInQueue) {
        switch (foundInQueue.status) {
          case "pending":
            status = "pending";
            break;
          case "error":
            status = "error";
            errorDetails = foundInQueue.error;
            break;
          case "imported":
            // It was marked imported but not found in Canvas
            // Allow user to retry import
            status = "new";
            break;
          default:
            status = foundInQueue.status;
            errorDetails = foundInQueue.error;
        }
      }

      summary = calcNewSummary(summary, status, errorDetails);

      return {
        id: exam.fileId,
        createDate: exam.createDate,
        student: exam.student,
        status,
        error: errorDetails,
      };
    });

    res.send({
      result: listOfExamsToHandle,
      summary,
    });
  } catch (err) {
    next(err);
  }
}

export {
  listScannedExams,
  listAllExams,
  throwIfNotExactlyOneLadokId as _throwIfNotExactlyOneLadokId,
};
