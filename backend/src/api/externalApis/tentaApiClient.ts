import got from "got";
import log from "skog";
import { Readable } from "stream";

import { tentaApiGenericErrorHandler } from "../error";

const client = got.extend({
  prefixUrl: process.env.TENTA_API_URL,
  headers: {
    "Ocp-Apim-Subscription-Key": process.env.TENTA_API_SUBSCRIPTION_KEY,
  },
});

async function getVersion() {
  const { body } = await client("Version");

  return body;
}

interface WindreamsScannedExam {
  createDate: string;
  fileId: number;
  student: {
    userId: string;
    personNumber: string;
    anonymousCode: string;
    firstName: string;
    lastName: string;
  };
}

/**
 * Helper function to find out if there are "s_code" properties for all exams,
 * then the assignment created should be anonymous.
 * 
 * TODO: Chalmers: This is where it gets messy with the "_CTH" suffix or "<GUID>_<GUID>",
 * we need to get the correct Ladok ID in Aldoc from canvasApi (sections) from the start...
 */
async function examIsAnonymous(ladokId) {
  log.debug(`Searching exams for Ladok ID ${ladokId} to find out if s_code is present, then it's anonymous.`);

  // Should probably throw instead of error in result object, but for now...
  let result = {
    error: false,
    error_text: '',
    anonymous: false,
  };

  let exam_s_code_list = [];

  const { body } = (await client("windream/search/documents/false", {
    method: "POST",
    json: {
      searchIndiceses: [
        {
          index: "e_ladokid",
          value: ladokId,
          useWildcard: false,
        },
      ],
      includeDocumentIndicesesInResponse: true,
      includeSystemIndicesesInResponse: false,
      useDatesInSearch: false,
    },
    responseType: "json",
  }).catch(tentaApiGenericErrorHandler)) as any;

  if (!body.documentSearchResults) {
    result.error = true;
    result.error_text = `No exams found for Ladok ID ${ladokId}`;

    log.error(result);
  }
  else {
    for (const result of body.documentSearchResults) {
      const getValue = (index) => result.documentIndiceses.find((di) => di.index === index)?.value;
      exam_s_code_list.push(getValue("s_code").length ? true : false);
    }

    const unique_s_code_list = Array.from(new Set(exam_s_code_list));

    if (unique_s_code_list.length > 1) {
      result.error = true;
      result.error_text = `There are both existing and non-existing 's_code' exams for Ladok ID ${ladokId}`;

      log.error(result);
    }
    else if (unique_s_code_list.length == 1 && unique_s_code_list[0] == true) {
      result.anonymous = true;
    }
    else {
      // anonymous default is false
    }
  }

  log.info(result);
  return result;
}

async function examListByLadokId(ladokId): Promise<WindreamsScannedExam[]> {
  const outp = <WindreamsScannedExam[]>[];

  log.debug(`Getting exams for Ladok ID ${ladokId}`);

  const { body } = (await client("windream/search/documents/false", {
    method: "POST",
    json: {
      searchIndiceses: [
        {
          index: "e_ladokid",
          value: ladokId,
          useWildcard: false,
        },
      ],
      includeDocumentIndicesesInResponse: true,
      includeSystemIndicesesInResponse: false,
      useDatesInSearch: false,
    },
    responseType: "json",
  }).catch(tentaApiGenericErrorHandler)) as any;

  if (!body.documentSearchResults) {
    log.debug(`No exams found with the "new format" e_ladokid=${ladokId}`);
    return [];
  }

  for (const result of body.documentSearchResults) {
    // Helper function to get the value of the attribute called "index"
    // we have written it because they are in an array instead of an object
    const getValue = (index) =>
      result.documentIndiceses.find((di) => di.index === index)?.value;

    outp.push({
      createDate: result.createDate,
      fileId: result.fileId,
      student: {
        userId: getValue("s_uid"),
        personNumber: getValue("s_pnr"),
        anonymousCode: getValue("s_code"),
        firstName: getValue("s_firstname"),
        lastName: getValue("s_lastname"),
      },
    });
  }

  if (!body.documentSearchResults) {
    log.debug(`No exams found with the "new format" e_ladokid=${ladokId}`);
    return [];
  }

  return outp;
}

/** Download the exam with ID "fileId". Returns its content as a ReadableStream */
async function downloadExam(fileId) {
  log.debug(`Downloading file ${fileId}...`);

  const { body } = (await client(`windream/file/${fileId}/true`, {
    responseType: "json",
  })) as any;

  const getValue = (index) =>
    body.wdFile.objectIndiceses.find((di) => di.index === index)?.value;

  const { fileName } = body.wdFile;
  const examDateTime = getValue("e_date");
  const examDate = examDateTime.split("T")[0];
  const student = {
    userId: getValue("s_uid"),
    personNumber: getValue("s_pnr"),
    anonymousCode: getValue("s_code"),
    firstName: getValue("s_firstname"),
    lastName: getValue("s_lastname"),
  };

  // Chalmers: just a debug logging to understand the data being written
  log.info(JSON.stringify(student));

  // ProcessQueueEntry will take care of this
  /*
  if (!student.userId)
    throw new Error(
      `Could not get User ID (s_uid) from TentaAPI (windream) for file id "${fileId}".`
    );
  */

  return {
    content: Readable.from(
      Buffer.from(body.wdFile.fileAsBase64.toString("utf-8"), "base64")
    ),
    fileName,
    student,
    examDate,
  };
}

export { examIsAnonymous, examListByLadokId, downloadExam, getVersion };
