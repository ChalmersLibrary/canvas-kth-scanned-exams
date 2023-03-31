import { MongoClient, ObjectId } from "mongodb";
import log from "skog";

const { MONGODB_CONNECTION_STRING } = process.env;
const DB_COLLECTION_NAME = "course_students";
const DB_COLLECTION_ENTRY_TTL = 900; // 15 mins

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
 * Return the collection.
 *
 * It also connects to the database if it's not already connected
 */
async function getCourseStudentsCollection() {
  // Note: `databaseConnection` is a promise and must be awaited to be used
  // Instansiate once, but not before it is used the first time
  await connectToDatabase();

  return databaseClient.db().collection(DB_COLLECTION_NAME);
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

class CourseStudentsEntry {
  courseId: number;
  students: string;
  createdAt: Date;

  constructor({
    courseId,
    students,
    createdAt = new Date(),
  }) {
    this.courseId = courseId;
    this.students = students;
    this.createdAt = createdAt;
  }

  toJSON() {
    return {
      courseId: this.courseId,
      students: this.students,
      createdAt: this.createdAt,
    };
  }
}

/**
 * Get students for a given course
 * 
 * @param courseId Canvas course id 
 * @returns 
 */
async function getCourseStudents(courseId): Promise<CourseStudentsEntry> {
    try {
        log.debug(`getCourseStudents(${courseId})`);
        const collection = await getCourseStudentsCollection();
        const doc = await collection.findOne({ courseId });
        log.debug(doc);

    return new CourseStudentsEntry(doc as any);
  } catch (err) {
    if (err.name === "TypeError") throw err;

    // TODO: Handle errors
    log.error({ err });
    throw err;
  }
}

/**
 * Add an entry for a given course
 * If an entry exists with given courseId, an error will be thrown.
 * @param {Object} entry This is the object
 * @returns CourseStudentsEntry
 */
async function addEntry(entry) {
  assert(entry.courseId !== undefined, "Param entry is missing courseId");

  // Type object to get defaults
  const typedEntry =
    entry instanceof CourseStudentsEntry ? entry : new CourseStudentsEntry(entry);

  try {
    const collection = await getCourseStudentsCollection();

    // Create an index on timestamp property to auto-expire after a while
    collection.createIndex( { "createdAt": 1 }, { expireAfterSeconds: DB_COLLECTION_ENTRY_TTL } )

    // In Typescript, _id requires an ObjectID, which in turn requires a hexa decimal string
    // of a fixed length. Here I am creating this string in a repeatable way.
    const tmpIdIn = typedEntry.courseId.toString(16);
    const newId = "000000000000000000000000".substr(tmpIdIn.length) + tmpIdIn;
    const res = await collection.insertOne({
      _id: new ObjectId(newId),
      ...typedEntry.toJSON(),
    });

    if (res.acknowledged) {
      // Return typed object
      return typedEntry;
    }
  } catch (err) {
    if (err.name === "TypeError") throw err;

    log.error(`Typed entry for Course Students with courseId ${typedEntry.courseId} already exists.`)
  }
}

async function removeEntry(entry) {
  try {
    const collection = await getCourseStudentsCollection();
    await collection.deleteOne({
      courseId: entry.courseId,
    });
  } catch (err) {
    if (err.name === "TypeError") throw err;

    log.error({ err });
  }
}

export {
    getCourseStudents,
    addEntry,
    removeEntry,
    databaseClient,
};
