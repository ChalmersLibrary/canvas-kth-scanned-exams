import CanvasApi from "@kth/canvas-api";
import FormData from "formdata-node";
import got from "got";
import log from "skog";
import JsonBig from "json-bigint";
import { getAktivitetstillfalle } from "./ladokApiClient";
import {
  EndpointError,
  FileUploadError,
  ImportError,
  canvasApiGenericErrorHandler,
} from "../error";
import {
  propertiesToCreateLockedAssignment,
  propertiesToUnlockAssignment,
  propertiesToLockAssignment,
  propertiesToCreateSubmission,
} from "../assignmentLock";

let canvas: CanvasApi;
if (process.env.NODE_ENV === "test") {
  log.info("NOTE: Not instantiating canvas api since this is a test!");
} else {
  canvas = new CanvasApi(
    process.env.CANVAS_API_URL,
    process.env.CANVAS_API_ADMIN_TOKEN
  );
}

/**
 * These endpoints have the content used as a template when creating the
 * homepage and assignment.
 */
const TEMPLATES = {
  assignment: {
    en: process.env.CANVAS_TEMPLATE_ASSIGNMENT_EN ? process.env.CANVAS_TEMPLATE_ASSIGNMENT_EN : "courses/24550/assignments/68009",
    sv: process.env.CANVAS_TEMPLATE_ASSIGNMENT_SV ? process.env.CANVAS_TEMPLATE_ASSIGNMENT_SV : "courses/24550/assignments/68009",
  },
  homepage: {
    en: process.env.CANVAS_TEMPLATE_COURSE_HOMEPAGE_EN ? process.env.CANVAS_TEMPLATE_COURSE_HOMEPAGE_EN : "courses/33450/pages/151311",
    sv: process.env.CANVAS_TEMPLATE_COURSE_HOMEPAGE_SV ? process.env.CANVAS_TEMPLATE_COURSE_HOMEPAGE_SV : "courses/33450/pages/151959",
  },
};

/** Get data from one canvas course */
async function getCourse(courseId) {
  const { body } = await canvas
    .get<any>(`courses/${courseId}`)
    .catch(canvasApiGenericErrorHandler);

  return body;
}

/** Creates a "good-looking" homepage in Canvas */
async function createHomepage(courseId, language = "en") {
  const { body: template } = await canvas
    .get<any>(TEMPLATES.homepage[language])
    .catch(canvasApiGenericErrorHandler);

  await canvas
    .request(`courses/${courseId}/front_page`, "PUT", {
      wiki_page: {
        // To make this page, use the Rich Content Editor in Canvas (https://kth.test.instructure.com/courses/30347/pages/welcome-to-the-exam/edit)
        body: template.body,
        title: template.title,
      },
    })
    .catch(canvasApiGenericErrorHandler);
  return canvas
    .request(`courses/${courseId}`, "PUT", {
      course: {
        default_view: "wiki",
      },
    })
    .catch(canvasApiGenericErrorHandler);
}

/** Publish a course */
async function publishCourse(courseId) {
  return canvas
    .request(`courses/${courseId}`, "PUT", {
      course: {
        event: "offer",
      },
    })
    .catch(canvasApiGenericErrorHandler);
}

/**
 * Get the correct Ladok Aktivitetstillfälle UUID of the examination, linked with a canvas course.
 * This information is (partly) in the Section SIS ID that represents certain criteria.
 * 
 * @param courseId Canvas course id
 */
async function getAktivitetstillfalleUUIDsFromSections(courseId: number) {
  const sections = await canvas
    .listItems<any>(`courses/${courseId}/sections`, { include: ["students"] } )
    .toArray()
    .catch(canvasApiGenericErrorHandler);

  // Get the Ladok UUID from the Sections SIS ID, configurable regex
  const REGEX = process.env.CANVAS_SECTION_LADOKID_REGEX ? new RegExp(process.env.CANVAS_SECTION_LADOKID_REGEX) : /([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})/;
  log.debug("Regex for Ladok UUID in Canvas section: " + REGEX);

  const sisIds = sections
    .filter((s) => s.students?.length) /* Filter out sections with 0 enrollments */
    .map((section) => section.sis_section_id?.match(REGEX)?.[1])
    .filter((sisId) => sisId) /* Filter out null and undefined */
  // Deduplicate IDs
  const uniqueIds = Array.from(new Set(sisIds));

  // Because we might need to filter the list
  let returnedIds = new Array();

  if (!uniqueIds.length) {
    log.error(`No Ladok UUID in section SIS data for Canvas course [${courseId}]!`);
  }
  else {
    if (uniqueIds.length > 1 && process.env.CANVAS_SECTION_LADOKID_MULTIPLE_FORCE_FIRST) {
      returnedIds.push(uniqueIds[0]);
      log.info(`Ladok UUID [${uniqueIds.toString()}] in section SIS data for Canvas course [${courseId}], returning [${returnedIds.toString()}] as configuration parameter CANVAS_SECTION_LADOKID_MULTIPLE_FORCE_FIRST is set.`);
    }
    else {
      returnedIds = uniqueIds;
      log.info(`Ladok UUID [${uniqueIds.toString()}] in section SIS data for Canvas course [${courseId}], returning [${returnedIds.join(",")}].`);
    }
  }

  return returnedIds as string[];
}

/** Get the Ladok UID of the examination linked with a canvas course */
async function getAktivitetstillfalleUIDs(courseId) {
  const sections = await canvas
    .listItems<any>(`courses/${courseId}/sections`)
    .toArray()
    .catch(canvasApiGenericErrorHandler);

  // For SIS IDs with format "AKT.<ladok id>.<suffix>", take the "<ladok id>"
  const REGEX = /^AKT\.([\w-]+)/;
  const sisIds = sections
    .map((section) => section.sis_section_id?.match(REGEX)?.[1])
    .filter((sisId) => sisId /* Filter out null and undefined */);

  // Deduplicate IDs (there are usually one "funka" and one "non-funka" with
  // the same Ladok ID)
  const uniqueIds = Array.from(new Set(sisIds));

  return uniqueIds as string[];
}

async function getValidAssignment(courseId, ladokId) {
  const thisPath = `courses/${courseId}/assignments`;

  const assignments = await canvas
    .listItems<any>(thisPath)
    .toArray()
    .catch(canvasApiGenericErrorHandler);

  log.debug(`Assignments with integration_data.ladokId ${ladokId} : ${assignments.filter(x => x.integration_data?.ladokId == ladokId).length}`);

  // TODO: Filter more strictly?
  // Chalmers: Changed === to ==, don't know why it didn't work?!? The types where not the same... 
  return (
    assignments.find((a) => a.integration_data?.ladokId == ladokId)
  );
}

type TSubmissionWithHistory = {
  submission_history: {
    attachments: {
      filename: string;
    }[];
  }[];
  user: {
    sis_user_id: string;
    login_id: string;
  };
}

async function getAssignmentSubmissions(courseId, assignmentId) {
  // API docs https://canvas.instructure.com/doc/api/submissions.html
  // GET /api/v1/courses/:course_id/assignments/:assignment_id/submissions
  // ?include=user (to get user obj wth kth id)
  return canvas
    .listItems<TSubmissionWithHistory>(
      `courses/${courseId}/assignments/${assignmentId}/submissions`,
      { include: ["user", "submission_history"] } // include user obj with kth id
    )
    .toArray()
    .catch(canvasApiGenericErrorHandler);
}

async function createAssignment(courseId, ladokId, anonymize = false, language = "en") {
  let examination;

  log.info(`Create Assignment: courseId [${courseId}] ladokId [${ladokId}] anonymous [${anonymize}] language [${language}]`);

  // Chalmers: If Ladok isn't configured, we can find information about examDate in course metadata instead.
  if (process.env.LADOK_API_BASEURL && process.env.LADOK_API_BASEURL != '') {
    examination = await getAktivitetstillfalle(ladokId);
  }
  else {
    const course = await getCourse(courseId);

    // TODO: Chalmers: Check that this date is really correct?
    examination = {
      examDate: course.start_at.substr(0, 10),
    };
  }

  const { body: template } = await canvas
    .get<any>(TEMPLATES.assignment[language])
    .catch(canvasApiGenericErrorHandler);

  return canvas
    .request(`courses/${courseId}/assignments`, "POST", {
      assignment: {
        ...propertiesToCreateLockedAssignment(examination.examDate),
        name: template.name,
        description: template.description,
        integration_data: {
          ladokId,
        },
        published: false,
        grading_type: "letter_grade",
        notify_of_update: false,
        anonymous_grading: anonymize,
        // TODO: take the grading standard from TentaAPI
        //       grading_standard_id: 1,      
      },
    })
    .then((r) => r.body as any)
    .catch(canvasApiGenericErrorHandler);
}

/** Publish an assignment */
async function publishAssignment(courseId, assignmentId) {
  return canvas
    .request(`courses/${courseId}/assignments/${assignmentId}`, "PUT", {
      assignment: {
        published: true,
      },
    })
    .catch(canvasApiGenericErrorHandler);
}

/**
 * Allows the app to upload exams.
 */
async function unlockAssignment(courseId, assignmentId) {
  return canvas
    .request(`courses/${courseId}/assignments/${assignmentId}`, "PUT", {
      assignment: {
        ...propertiesToUnlockAssignment(),
        published: true,
      },
    })
    .catch(canvasApiGenericErrorHandler);
}

/**
 * Prevents students to upload things by accident.
 */
async function lockAssignment(courseId, assignmentId) {
  return canvas
    .request(`courses/${courseId}/assignments/${assignmentId}`, "PUT", {
      assignment: {
        ...propertiesToLockAssignment(),
      },
    })
    .catch(canvasApiGenericErrorHandler);
}

function uploadFileErrorHandler(err): never {
  Error.captureStackTrace(err, uploadFileErrorHandler);

  throw new FileUploadError({
    type: "unhandled_error",
    message: "Error uploading file to storage",
    err,
  });
}

// eslint-disable-next-line camelcase
async function sendFile({ upload_url, upload_params }, content) {
  const form = new FormData();

  // eslint-disable-next-line camelcase
  for (const key in upload_params) {
    if (upload_params[key]) {
      form.append(key, upload_params[key]);
    }
  }

  form.append("attachment", content, upload_params.filename);

  return got
    .post<any>({
      url: upload_url,
      body: form.stream,
      headers: form.headers,
      responseType: "json",
    })
    .catch(uploadFileErrorHandler);
}

// TODO: Refactor this function and uploadExam to avoid requesting the endpoint
//       "GET users/sis_user_id:${userId}" twice
// TODO: Chalmers: Refactor because sis_user_id != userId (CID), its pnr
// TODO: Is this function used at all???
async function hasSubmission({ courseId, assignmentId, userId }) {
  log.debug(`hasSubmission() called for user [${userId}]`);

  try {
    const { body: user } = await canvas
      .get<any>(`users/sis_user_id:${userId}`)
      .catch(canvasApiGenericErrorHandler);
    const { body: submission } = await canvas
      .get<any>(
        `courses/${courseId}/assignments/${assignmentId}/submissions/${user.id}`
      )
      .catch(canvasApiGenericErrorHandler);

    return !submission.missing;
  } catch (err) {
    if (err.response?.statusCode === 404) {
      return false;
    }
    throw err;
  }
}

/**
 * Uploads exam as submission to correct assignment in Canvas.
 */
async function uploadExam(
  content,
  { courseId, studentCanvasInternalId, studentUserId, studentAnonymousCode, examDate, fileId }
) {
  try {
    const ladokId = await getAktivitetstillfalleUUIDsFromSections(courseId);
    const assignment = await getValidAssignment(courseId, ladokId);

    log.debug("Found Assignment: " + JSON.stringify(assignment));

    log.debug(
      `Upload Exam: unlocking assignment ${assignment.id} in course ${courseId}`
    );

    const reqTokenStart = Date.now();
    // TODO: will return a 400 if the course is unpublished
    const { body: slot } = await canvas
      .request<any>(
        `courses/${courseId}/assignments/${assignment.id}/submissions/${studentCanvasInternalId}/files`,
        "POST",
        {
          name: `${fileId}.pdf`,
        }
      )
      .catch((err): never => {
        log.error(err);
        if (err.response?.statusCode === 404) {
          // Student is missing in Canvas, we can fix this
          throw new ImportError({
            type: "missing_student",
            message: "Student is missing in examroom",
            details: {
              canvasInternalId: studentCanvasInternalId,
              userId: studentUserId,
            },
          });
        } else {
          // Other errors from Canvas API that we don't know how to fix
          throw new ImportError({
            type: "import_error",
            message: `Canvas returned an error when importing this exam (windream fileId: ${fileId})`,
            details: {
              studentCanvasInternalId,
              studentUserId,
              fileId,
            },
          });
        }
      });

    log.debug(
      "Time to generate upload token: " + (Date.now() - reqTokenStart) + "ms"
    );
    log.debug(slot);

    const uploadFileStart = Date.now();

    // In order to handle large user id in response, we parse the raw response with json-bigint
    const { rawBody: rawUploadedFileResponse } = await sendFile(slot, content);
    let rawUploadedFile = rawUploadedFileResponse.toString();
    const uploadedFile = JsonBig.parse(rawUploadedFile);
    
    log.debug("Time to upload file: " + (Date.now() - uploadFileStart) + "ms");

    // TODO: move the following statement outside of this function
    // Reason: this module (canvasApiClient) should not contain "business rules"
    await unlockAssignment(courseId, assignment.id);

    // Get existing submission history for this student and assignment to figure out
    // timestamp offset. If we submit on the same timestamp (submitted_at), the old
    // submission gets overwritten.
    const { body: submission } = await getAssignmentSubmissionForStudent({
      courseId,
      assignmentId: assignment.id,
      userId: studentUserId,
      userCanvasInternalId: studentCanvasInternalId,
    });

    // There is always a submission to start with in the history with status "unsubmitted"
    // so we need to filter that out when getting nrof actual submissions
    const nrofSubmissions =
      submission.submission_history?.filter(
        (s) => s.workflow_state !== "unsubmitted"
      ).length ?? 0;
    const submissionProps = propertiesToCreateSubmission(
      examDate,
      nrofSubmissions
    );
    const { submitted_at } = submissionProps;

    let submissionObject = {
      submission: {
        ...submissionProps,
        submission_type: "online_upload",
        user_id: studentCanvasInternalId,
        file_ids: [uploadedFile.id],
      },
      comment: {},
    };

    // Add the "Anonymkod" as a text comment if it exists
    if (studentAnonymousCode) {
      submissionObject.comment = {
        text_comment: studentAnonymousCode,
      };
    }

    log.info(submissionObject);

    await canvas
      .request(
        `courses/${courseId}/assignments/${assignment.id}/submissions/`,
        "POST",
        submissionObject
      )
      .catch(canvasApiGenericErrorHandler);

    return submitted_at;
  } catch (err) {
    if (err.type === "missing_student") {
      log.warn(`User with internal id ${studentCanvasInternalId} is missing in Canvas course ${courseId}`);
    }
    else if (!studentCanvasInternalId) {
      log.warn(
        `User is missing internal Canvas User Id, needs du be manually graded: Windream fileid ${fileId} / course ${courseId}`
      );
    }
    else {
      log.error(
        { err },
        `Error when uploading exam: User id ${studentUserId} internal id ${studentCanvasInternalId} / course ${courseId}`
      );
    }
    throw err;
  }
}

// TOOD: This function can take very long to run. Consider changing it somehow
async function getRoles(courseId, userId) {
  if (!courseId) {
    throw new EndpointError({
      type: "missing_argument",
      statusCode: 400,
      message: "Missing argument [courseId]",
    });
  }

  if (!userId) {
    throw new EndpointError({
      type: "missing_argument",
      statusCode: 400,
      message: "Missing argument [userId]",
    });
  }

  // TODO: error handling for non-existent courseId or userId
  const enrollments = await canvas
    .listItems<any>(`courses/${courseId}/enrollments`, { per_page: 100 })
    .toArray()
    .catch(canvasApiGenericErrorHandler);

  return enrollments
    .filter((enr) => enr.user_id === userId)
    .map((enr) => enr.role_id);
}

async function getAssignmentSubmissionForStudent({
  courseId,
  assignmentId,
  userId,
  userCanvasInternalId,
}) {
  log.debug(`getAssignmentSubmissionForStudent() called for user [${userId}] internal id [${userCanvasInternalId}]`);

  return canvas
    .get<{ submission_history: { workflow_state: string }[] }>(
      `courses/${courseId}/assignments/${assignmentId}/submissions/${userCanvasInternalId}`,
      { include: ["submission_history"] }
    )
    .catch(canvasApiGenericErrorHandler);
}

async function enrollStudent(courseId, userId) {
  return canvas
    .request(`courses/${courseId}/enrollments`, "POST", {
      enrollment: {
        user_id: `sis_user_id:${userId}`,
        role_id: 3,
        enrollment_state: "active",
        notify: false,
      },
    })
    .catch(canvasApiGenericErrorHandler);
}

/**
 * Returns the internal Canvas User Id for student based on data in Users, searching "sis_login_id".
 * 
 * @param studentUserId Student userid (login_id)
 */
async function getInternalCanvasUserIdFromSisLoginId(studentUserId: string) {
  const { body: user } = await canvas
  .get<any>(`users/sis_login_id:${studentUserId}`)
  .catch((err): any => {
    if (err.response?.statusCode === 404) {
      log.error(`Student [${studentUserId}] not found in Canvas!`);
    }
    else {
      log.error(err);
    }
  });

  return user?.id.toString();
}


interface TCanvasUser {
  id: string;
  name: string;
  sis_user_id: string;
  root_account: string;
  login_id: string;
  uuid: string;
};

/**
 * Returns the Canvas Student in a given course based on search (only in course) for PersonNumber.
 * 
 * @param courseId Canvas course id
 * @param studentPersonNumber Person Number (personnummer)
 */
async function getInternalCanvasUserFromPersonNumber(courseId: number, studentPersonNumber: string) {
  let user: TCanvasUser;

    // In order to handle large user id in response, we parse the raw response with json-bigint
  const { rawBody: usersBuffer } = await canvas.get<any>(`courses/${courseId}/search_users`, {
      "enrollment_type[]": "student",
      "include[]": "uuid",
      "search_term": studentPersonNumber
    },
  )
  .catch(canvasApiGenericErrorHandler);
  
  let rawUsers = usersBuffer.toString();
  const users = JsonBig.parse(rawUsers);

  if (users.length == 0) {
    log.error(`No match found for [${studentPersonNumber}] in Canvas course id [${courseId}].`)
  }
  else if (users.length > 1) {
    throw new ImportError({
      type: "multiple_students",
      message: "More than one student in examroom matches personnummer.",
      details: {
        studentPersonNumber: studentPersonNumber,
        courseId: courseId,
      },
    });
    // log.error(`More than one match found for [${studentPersonNumber}] in Canvas course id [${courseId}], something is wrong.`);
  }
  else {
    user = users[0];
  }

  return user;
}

export {
  getCourse,
  publishCourse,
  createHomepage,
  getAktivitetstillfalleUIDs,
  getAktivitetstillfalleUUIDsFromSections,
  getValidAssignment,
  getAssignmentSubmissions,
  createAssignment,
  publishAssignment,
  unlockAssignment,
  lockAssignment,
  hasSubmission,
  uploadExam,
  getRoles,
  enrollStudent,
  getInternalCanvasUserIdFromSisLoginId,
  getInternalCanvasUserFromPersonNumber,
};
