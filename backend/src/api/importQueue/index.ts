import { MongoClient, ObjectId } from "mongodb";
import log from "skog";
import { ImportError } from "../error";

const { MONGODB_CONNECTION_STRING } = process.env;
const DB_QUEUE_NAME = "import_queue";

const databaseClient = new MongoClient(MONGODB_CONNECTION_STRING, {
  maxPoolSize: 5,
  minPoolSize: 1,
});

let databaseConnection;
function connectToDatabase() {
  databaseConnection = databaseConnection || databaseClient.connect();
  return databaseConnection;
}

/**
 * Return the Import Queue collection.
 *
 * It also connects to the database if it's not already connected
 */
async function getImportQueueCollection() {
  // Note: `databaseConnection` is a promise and must be awaited to be used
  // Instansiate once, but not before it is used the first time
  await connectToDatabase();

  return databaseClient.db().collection(DB_QUEUE_NAME);
}

/**
 * For runtime input param testing
 * @param {bool|function} test Test case that should return true
 * @param {string} msg Error message
 */
function assert(test: boolean | Function, msg: string): void {
  if ((typeof test === "function" && !test()) || !test) {
    throw Error(msg);
  }
}

/* eslint max-classes-per-file: off */

type TStudent = {
  canvasInternalId: string;
  userId: string;
  personNumber: string;
  anonymousCode: string;
  firstName: string;
  lastName: string;
};

export type TQueueEntryError = {
  type: string;
  message: string;
  details?: object; // Additional error details
};

class QueueEntry {
  fileId: number;
  fileCreateDate: string;
  courseId: number;
  student: TStudent;
  status: string;
  createdAt?: Date;
  importStartedAt?: Date;
  importSuccessAt?: Date;
  lastErrorAt?: Date;
  error?: TQueueEntryError;

  constructor({
    fileId,
    fileCreateDate,
    courseId,
    student,
    status = "new",
    createdAt = new Date(),
    importStartedAt,
    importSuccessAt,
    lastErrorAt,
    error,
  }) {
    this.fileId = fileId;
    this.fileCreateDate = fileCreateDate;
    this.courseId = courseId;
    this.student = {
      canvasInternalId: student?.canvasInternalId,
      userId: student?.userId,
      personNumber: student?.personNumber,
      anonymousCode: student?.anonymousCode,
      firstName: student?.firstName,
      lastName: student?.lastName,
    };
    this.status = status;
    this.createdAt = createdAt;
    this.importStartedAt = importStartedAt;
    this.importSuccessAt = importSuccessAt;
    this.lastErrorAt = lastErrorAt;
    this.error = error;
  }

  toJSON() {
    return {
      fileId: this.fileId,
      fileCreateDate: this.fileCreateDate,
      courseId: this.courseId,
      student: {
        canvasInternalId: this.student?.canvasInternalId,
        userId: this.student?.userId,
        personNumber: this.student?.personNumber,
        anonymousCode: this.student?.anonymousCode,
        firstName: this.student?.firstName,
        lastName: this.student?.lastName,
      },
      status: this.status,
      createdAt: this.createdAt,
      importStartedAt: this.importStartedAt || null,
      importSuccessAt: this.importSuccessAt || null,
      lastErrorAt: this.lastErrorAt || null,
      error: this.error || null,
    };
  }
}

enum EQueueStatus {
  IDLE = "idle",
  WORKING = "working",
}

type TQueueSummary = {
  total: number;
  progress: number;
  error: number;
  ignored: number;
  imported: number;
};

class QueueStatus {
  /**
   * Status of import queue
   */
  status: EQueueStatus;
  working: TQueueSummary;

  constructor({
    status,
    total,
    progress = 0,
    error = 0,
    ignored = 0,
    imported = 0,
  }) {
    this.status = status;
    if (total !== undefined) {
      this.working = {
        error,
        progress,
        total,
        imported,
        ignored,
      };
    }
  }

  toJSON() {
    if (this.working !== undefined) {
      return {
        status: this.status,
        working: {
          progress: this.working.progress,
          total: this.working.total,
          error: this.working.error,
          ignored: this.working.ignored,
          imported: this.working.imported,
        },
      };
    }

    return { status: this.status };
  }
}

/**
 * Get list of exams in import queue for given course
 * @param {String} courseId
 * @returns an array of QueueEntry objects
 */
async function getEntriesFromQueue(courseId) {
  try {
    // Open collection
    const collImportQueue = await getImportQueueCollection();
    const cursor = collImportQueue.find({ courseId });

    const entries = await cursor.toArray();

    return entries.map((entry) => new QueueEntry(entry as any));
  } catch (err) {
    if (err.name === "TypeError") throw err;

    // TODO: Handle errors
    log.error({ err });
    throw new ImportError({
      err,
    });
  }
}

async function getEntryFromQueue(fileId): Promise<QueueEntry> {
  try {
    // Open collection
    const collImportQueue = await getImportQueueCollection();
    const doc = await collImportQueue.findOne({ fileId });

    return new QueueEntry(doc as any);
  } catch (err) {
    if (err.name === "TypeError") throw err;

    // TODO: Handle errors
    log.error({ err });
    throw err;
  }
}

/**
 * Remove entries with status "imported" and set those with status
 * "error" to "pending" so they can be re-imported.
 * @param {String} courseId
 */
async function resetQueueForImport(courseId) {
  try {
    const collImportQueue = await getImportQueueCollection();
    await collImportQueue.deleteMany({
      courseId,
      status: {
        $in: ["imported", "error", "ignored"],
      },
    });
  } catch (err) {
    if (err.name === "TypeError") throw err;

    log.error({ err });
    throw new ImportError({
      type: "delete_error",
      statusCode: 420,
      message: "Error removing finished entries",
    });
  }
}

/**
 * Add an entry to the import queue
 * If an entry exists with given fileId, an error will be thrown.
 * @param {Object} entry This is a QueueEntry like object
 * @returns QueueEntry
 */

async function addEntryToQueue(entry) {
  assert(entry.fileId !== undefined, "Param entry is missing fileId");
  assert(
    entry.fileCreateDate !== undefined,
    "Param entry is missing fileCreateDate"
  );
  assert(entry.courseId !== undefined, "Param entry is missing courseId");

  // Type object to get defaults
  const typedEntry =
    entry instanceof QueueEntry ? entry : new QueueEntry(entry);

  try {
    const collImportQueue = await getImportQueueCollection();

    // Add entry

    // In Typescript, _id requires an ObjectID, which in turn requires a hexa decimal string
    // of a fixed length. Here I am creating this string in a repeatable way.
    const tmpIdIn = typedEntry.fileId.toString(16);
    const newId = "000000000000000000000000".substr(tmpIdIn.length) + tmpIdIn;
    const res = await collImportQueue.insertOne({
      _id: new ObjectId(newId),
      ...typedEntry.toJSON(),
    });

    if (res.acknowledged) {
      // Return typed object
      return typedEntry;
    }
    // TODO: Should we check reason?
    throw new ImportError({
      type: "insert_error",
      statusCode: 420,
      message: "Could not insert entry into queue",
    });
  } catch (err) {
    if (err.name === "TypeError") throw err;

    throw new ImportError({
      type: "entry_exists",
      statusCode: 409,
      message: `Add to queue failed because entry exist for this fileId '${typedEntry.fileId}'`,
      err,
    });
  }
}

async function getStatusFromQueue(courseId) {
  try {
    const collImportQueue = await getImportQueueCollection();
    const cursor = collImportQueue.find({ courseId });

    let pending = 0;
    let error = 0;
    let imported = 0;
    let ignored = 0;

    await cursor.forEach((doc) => {
      switch (doc.status) {
        case "pending":
          pending++;
          break;
        case "error":
          error++;
          break;
        case "imported":
          imported++;
          break;
        case "ignored":
          ignored++;
          break;
        default: // noop
      }
    });

    const status = pending === 0 ? "idle" : "working";
    const total = pending + error + imported + ignored;
    const progress = error + imported + ignored;

    return new QueueStatus({
      status,
      total,
      progress,
      error,
      imported,
      ignored,
    });
  } catch (err) {
    if (err.name === "TypeError") throw err;

    // TODO: Handle errors
    log.error({ err });
    throw err;
  }
}

async function updateStudentOfEntryInQueue(
  entry,
  { canvasInternalId, userId, personNumber, anonymousCode, firstName, lastName }
) {
  try {
    const collImportQueue = await getImportQueueCollection();
    const tmpOld = await collImportQueue.findOne({ fileId: entry.fileId });

    if (!tmpOld) {
      throw new ImportError({
        type: "entry_not_found",
        message: `Entry for fileId [${entry.fileId}] not found.`,
      });
    }

    const typedEntry = new QueueEntry(tmpOld as any);

    typedEntry.student = {
      canvasInternalId,
      userId,
      personNumber,
      anonymousCode,
      firstName,
      lastName,
    };

    const res = await collImportQueue.replaceOne(
      { fileId: typedEntry.fileId },
      typedEntry
    );

    if (!res.acknowledged) {
      throw new ImportError({
        type: "update_error",
        statusCode: 420,
        message: `Update import queue didn't get acknowledge from Mongodb.`,
      });
    }

    return typedEntry;
  } catch (err) {
    if (err.name === "TypeError") throw err;

    log.error({ err });
    throw err;
  }
}

async function updateStatusOfEntryInQueue(
  entry,
  status,
  errorDetails?: TQueueEntryError
) {
  try {
    const collImportQueue = await getImportQueueCollection();

    // Perform update
    const tmpOld = await collImportQueue.findOne({ fileId: entry.fileId });
    if (tmpOld) {
      const typedEntry = new QueueEntry(tmpOld as any);
      typedEntry.status = status;
      switch (status) {
        case "pending":
          typedEntry.importStartedAt = new Date();
          typedEntry.error = null;
          break;
        case "imported":
          typedEntry.importSuccessAt = new Date();
          typedEntry.error = null;
          break;
        case "ignored":
          // User has explicitly chosen to ignore this error
          typedEntry.error = null;
          break;
        case "error":
          typedEntry.lastErrorAt = new Date();
          typedEntry.error = errorDetails || {
            type: "error",
            message: "An error occured but no details were provided.",
          };
          break;
        default: // noop
      }

      const res = await collImportQueue.replaceOne(
        { fileId: typedEntry.fileId },
        typedEntry
      );
      if (!res.acknowledged) {
        throw new ImportError({
          type: "update_error",
          statusCode: 420,
          message: `Update import queue didn't get acknowledge from Mongodb.`,
        });
      }

      if (res.matchedCount < 1) {
        throw new ImportError({
          type: "not_found",
          statusCode: 404,
          message: `Entry ${entry.fileId} in import queue not found.`,
        });
      }

      // Return updated object
      return new QueueEntry(typedEntry as any);
    }

    return null;
  } catch (err) {
    if (err.name === "TypeError") throw err;

    // TODO: Handle errors
    log.error({ err });
    throw err;
  }
}

async function getFirstPendingFromQueue() {
  try {
    const collImportQueue = await getImportQueueCollection();
    const doc = await collImportQueue.findOne(
      { status: "pending" },
      { sort: { fileCreateDate: 1 } }
    );

    if (!doc) {
      return null;
    }

    return new QueueEntry(doc as any);
  } catch (err) {
    if (err.name === "TypeError") throw err;

    // TODO: Handle errors
    log.error({ err });
    throw err;
  }
}

async function removeEntryFromQueue(entry) {
  try {
    const collImportQueue = await getImportQueueCollection();
    await collImportQueue.deleteOne({
      fileId: entry.fileId,
    });
  } catch (err) {
    if (err.name === "TypeError") throw err;

    log.error({ err });
    throw new ImportError({
      type: "delete_error",
      statusCode: 420,
      message: "Error removing finished entries",
    });
  }
}

export {
  QueueEntry,
  QueueStatus,
  getEntryFromQueue,
  getEntriesFromQueue,
  addEntryToQueue,
  updateStatusOfEntryInQueue,
  updateStudentOfEntryInQueue,
  getStatusFromQueue,
  getFirstPendingFromQueue,
  resetQueueForImport,
  getImportQueueCollection,
  removeEntryFromQueue,
  databaseClient,
};
