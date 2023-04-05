import React from "react";
import {
  useImportQueueErrors,
  useMutateResetImportQueue,
} from "../../../common/api";
import { ExamErrorTable, H2, PrimaryButton, SecondaryButton } from "../../widgets";

// TODO: do something with `ignored` (errors that are not fixed)
export default function VerifyResults({ courseId, imported, ignored }: any) {
  const {
    mutate: doResetImportQueue,
    isLoading: resettingQueue,
    isSuccess: queueResetted,
  } = useMutateResetImportQueue(courseId);
  const { data: exams = [] } = useImportQueueErrors(courseId);

  const ignoredExams = exams.filter((exam: any) => exam.status === "ignored");

  return (
    <div className="max-w-2xl">
      <H2>Verify Results</H2>
      <div className="mt-8">
        {imported} exams have been imported. Go to the Assignment to use Speedgrader or download the submissions.
      </div>
      <details className="mt-8">
        <summary>{ignoredExams.length} exams could not be imported</summary>
        <ExamErrorTable exams={ignoredExams} />
      </details>
      <div className="mt-8">
        <SecondaryButton
          className="sm:w-auto"
          waiting={resettingQueue}
          success={queueResetted}
          onClick={() => doResetImportQueue()}
        >
          Reset and import again
        </SecondaryButton>
        <PrimaryButton className="sm:w-auto">Go to Assignment</PrimaryButton>
        {/* <PrimaryButton className="sm:w-auto">Log out</PrimaryButton> */}
      </div>
    </div>
  );
}
