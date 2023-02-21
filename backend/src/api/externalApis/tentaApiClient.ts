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
    id: string;
    firstName: string;
    lastName: string;
  };
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

    // TODO: Chalmers: should we check s_uid here and find it with sis_user_id s_pnr instead?
    outp.push({
      createDate: result.createDate,
      fileId: result.fileId,
      student: {
        id: getValue("s_uid"),
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
  log.info(`Downloading file ${fileId}...`);
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
    // TODO: Chalmers: add property for "anonymkod" here:
    //       anonymousCode: getValue("s_code"),
    firstName: getValue("s_firstname"),
    lastName: getValue("s_lastname"),
  };

  // Chalmers: just a debug logging to understand the data being written
  log.info(JSON.stringify(student));

  // TODO: Chalmers: if missing, should we check s_pnr in canvasApi search for sis_user_id to get uid?
  if (!student.userId)
    throw new Error(
      `Could not get User ID (s_uid) from TentaAPI (windream) for file id "${fileId}".`
    );

  return {
    content: Readable.from(
      Buffer.from(body.wdFile.fileAsBase64.toString("utf-8"), "base64")
    ),
    fileName,
    student,
    examDate,
  };
}

export { examListByLadokId, downloadExam, getVersion };
