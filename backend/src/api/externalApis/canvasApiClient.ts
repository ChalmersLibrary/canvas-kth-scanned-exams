import CanvasApi from "@kth/canvas-api";
import FormData from "formdata-node";
import got from "got";
import log from "skog";
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
    en: process.env.CANVAS_TEMPLATE_COURSE_HOMEPAGE_EN ? CANVAS_TEMPLATE_COURSE_HOMEPAGE_EN : "courses/33450/pages/151311",
    sv: process.env.CANVAS_TEMPLATE_COURSE_HOMEPAGE_SV ? CANVAS_TEMPLATE_COURSE_HOMEPAGE_SV : "courses/33450/pages/151959",
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

/** Get the Ladok UID of the examination linked with a canvas course */
async function getAktivitetstillfalleUIDs(courseId) {
  const sections = await canvas
    .listItems<any>(`courses/${courseId}/sections`)
    .toArray()
    .catch(canvasApiGenericErrorHandler);

  log.info(sections);

  // Get the Ladok UUID from the Sections SIS ID, configurable regex
  const REGEX = process.env.CANVAS_SECTION_LADOKID_REGEX ? new RegExp(process.env.CANVAS_SECTION_LADOKID_REGEX) : /([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})/;
  log.info("Regex for Ladok UUID in Canvas section: " + REGEX);

  const sisIds = sections
    .map((section) => section.sis_section_id?.match(REGEX)?.[1])
    .filter((sisId) => sisId /* Filter out null and undefined */);

  // Deduplicate IDs (there are usually one "funka" and one "non-funka" with
  // the same Ladok ID)
  const uniqueIds = Array.from(new Set(sisIds));

  log.info(`Found Ladok UUID ${uniqueIds.toString()} for Canvas course "${courseId}"`);

  return uniqueIds as string[];
}

// TODO: this function is kept only for backwards-compatibility reasons
async function getExaminationLadokId(courseId) {
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

  // Right now we are not supporting rooms with more than one examination
  if (uniqueIds.length !== 1) {
    throw new Error(
      `Course ${courseId} not supported: it is connected to ${uniqueIds.length} different Ladok Ids`
    );
  } else {
    return uniqueIds[0] as string;
  }
}

async function getValidAssignment(courseId, ladokId) {
  const thisPath = `courses/${courseId}/assignments`;
  log.info("GET " + thisPath);

  const assignments = await canvas
    .listItems<any>(thisPath)
    .toArray()
    .catch(canvasApiGenericErrorHandler);

  log.info(`Assignments for courseId ${courseId}: ${assignments.length}`);
  log.info(`Assignments with integration_data.ladokId ${ladokId} : ${assignments.filter(x => x.integration_data?.ladokId == ladokId).length}`);

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

async function createAssignment(courseId, ladokId, language = "en") {
  const course = await getCourse(courseId);
  console.log(course);

  // const examination = await getAktivitetstillfalle(ladokId); // We don't need Ladok for this, should be in Canvas course
  const examination = {
    examDate: course.start_at.substr(0, 10),
  };

  log.info(examination);

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
        // TODO: take the grading standard from TentaAPI
        //       grading_standard_id: 1,
        // TODO: Chalmers: Anonymous grading, depends on if there is index "s_code" from Aldoc,
        //       not sure how to find out about this, take first file matching Ladok UUID and check?
        //       anonymize_students: true,
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
async function hasSubmission({ courseId, assignmentId, userId }) {
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

async function uploadExam(
  content,
  { courseId, studentKthId, examDate, fileId }
) {
  try {
    // Chalmers: In our Canvas, sis_user_id is "pnr", not the login id (what is mapped to studentKthId).
    // TODO: Rename "studentKthId" with something more general like "studentId"?
    let canvasApiUserQueryUrl;
    if (process.env.CANVAS_USER_KEY_IS_LOGIN_ID) {
      canvasApiUserQueryUrl = `users/sis_login_id:${studentKthId}@chalmers.se`;
    }
    else {
      canvasApiUserQueryUrl = `users/sis_user_id:${studentKthId}`;
    }

    log.info("Get user details: " + canvasApiUserQueryUrl);
    
    const { body: user } = await canvas
      .get<any>(canvasApiUserQueryUrl)
      .catch(canvasApiGenericErrorHandler);

    // Chalmers: function says "kept for backwards compatibility"???
    // const ladokId = await getExaminationLadokId(courseId);
    const ladokId = await getAktivitetstillfalleUIDs(courseId);
    const assignment = await getValidAssignment(courseId, ladokId);
    log.info("Found Assignment: " + JSON.stringify(assignment));

    log.info( // originally: debug
      `Upload Exam: unlocking assignment ${assignment.id} in course ${courseId}`
    );

    const reqTokenStart = Date.now();
    // TODO: will return a 400 if the course is unpublished
    const { body: slot } = await canvas
      .request<any>(
        `courses/${courseId}/assignments/${assignment.id}/submissions/${user.id}/files`,
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
              kthId: studentKthId,
            },
          });
        } else {
          // Other errors from Canvas API that we don't know how to fix
          throw new ImportError({
            type: "import_error",
            message: `Canvas returned an error when importing this exam (windream fileId: ${fileId})`,
            details: {
              kthId: studentKthId,
              fileId,
            },
          });
        }
      });

    log.debug(
      "Time to generate upload token: " + (Date.now() - reqTokenStart) + "ms"
    );

    const uploadFileStart = Date.now();
    const { body: uploadedFile } = await sendFile(slot, content);

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
      userId: user.id,
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

    await canvas
      .request(
        `courses/${courseId}/assignments/${assignment.id}/submissions/`,
        "POST",
        {
          submission: {
            ...submissionProps,
            submission_type: "online_upload",
            user_id: user.id,
            file_ids: [uploadedFile.id],
          },
        }
      )
      .catch(canvasApiGenericErrorHandler);

    return submitted_at;
  } catch (err) {
    if (err.type === "missing_student") {
      log.warn(`User ${studentKthId} is missing in Canvas course ${courseId}`);
    } else if (!studentKthId) {
      log.warn(
        `User is missing KTH ID, needs du be manually graded: Windream fileid ${fileId} / course ${courseId}`
      );
    } else {
      log.error(
        { err },
        `Error when uploading exam: KTH ID ${studentKthId} / course ${courseId}`
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
}) {
  return canvas
    .get<{ submission_history: { workflow_state: string }[] }>(
      `courses/${courseId}/assignments/${assignmentId}/submissions/${userId}`,
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

export {
  getCourse,
  publishCourse,
  createHomepage,
  getAktivitetstillfalleUIDs,
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
};
