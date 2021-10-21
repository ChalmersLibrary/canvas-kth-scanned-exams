import React from "react";
import {
  useImportQueueErrors,
  useMutateFixImportQueueErrors,
  useMutateIgnoreImportQueueErrors,
} from "../../../common/api";
import {
  H2,
  LoadingPage,
  PrimaryButton,
  SecondaryButton,
  P,
} from "../../widgets";

export default function ResolveIssues({ courseId }) {
  const { data: exams = [], isFetching } = useImportQueueErrors(courseId);
  const examsWithMissingStudentError = exams.filter(
    (exam) => exam.error?.type === "missing_student"
  );
  const examsWithOtherErrors = exams.filter(
    (exam) => exam.error?.type !== "missing_student"
  );

  if (isFetching) {
    return <LoadingPage>Loading...</LoadingPage>;
  }

  if (examsWithMissingStudentError.length > 0) {
    return (
      <MissingStudents
        courseId={courseId}
        exams={examsWithMissingStudentError}
      />
    );
  } else if (examsWithOtherErrors.length > 0) {
    return <OtherErrors courseId={courseId} exams={examsWithOtherErrors} />;
  }

  // We should not render anything at this point
  // However the "parent" container might not be updated during a second

  return <div></div>;
}

function MissingStudents({ courseId, exams }) {
  const { mutate: doFixMissingStudents } = useMutateFixImportQueueErrors(
    courseId,
    exams
  );
  const { mutate: doIgnoreMissingStudents } = useMutateIgnoreImportQueueErrors(
    courseId,
    exams
  );

  return (
    <div>
      <h3 className="font-semibold text-lg">Missing students</h3>
      <P>
        There are {exams.length} exams where the student hasn&apos;t yet been
        added to your exam room.
      </P>
      <div className="mt-8">
        {exams.map((exam, index) => (
          <ExamErrorRow key={exam.id} exam={exam} rowNr={index + 1} />
        ))}
      </div>
      <div className="mt-8">
        <PrimaryButton
          className="sm:w-auto"
          onClick={() => doFixMissingStudents()}
        >
          Add students and import exams
        </PrimaryButton>
        <SecondaryButton
          className="sm:w-auto"
          onClick={() => doIgnoreMissingStudents()}
        >
          Ignore this problem
        </SecondaryButton>
      </div>
    </div>
  );
}

function OtherErrors({ courseId, exams }) {
  const { mutate: doFixOtherErrors } = useMutateFixImportQueueErrors(
    courseId,
    exams
  );
  const { mutate: doIgnoreOtherErrors } = useMutateIgnoreImportQueueErrors(
    courseId,
    exams
  );

  return (
    <div>
      <h3 className="font-semibold text-lg">Other errors</h3>
      <P>
        <b>
          There are {exams.length} exams that can&apos;t be imported at this
          time.
        </b>{" "}
        This is due to issues we can&apos;t automatically solve. Once the issues
        with these exams have been solved click &quot;Try to import again&quot;
        to retry importing these exams.
      </P>
      <P>
        Contact IT-support if you don&apos;t know how to resolve these issues.
      </P>
      <div className="mt-8">
        {exams.map((exam, index) => (
          <ExamErrorRow key={exam.fileId} exam={exam} rowNr={index + 1} />
        ))}
      </div>
      <div className="mt-8">
        <PrimaryButton className="sm:w-auto" onClick={() => doFixOtherErrors()}>
          Try to import again
        </PrimaryButton>
        <SecondaryButton
          className="sm:w-auto"
          onClick={() => doIgnoreOtherErrors()}
        >
          Ignore this problem
        </SecondaryButton>
      </div>
    </div>
  );
}

function ExamErrorRow({ exam, rowNr }) {
  return (
    <div className="flex flex-row mt-1">
      <div className="p-2 w-8">{rowNr}</div>
      <div className="p-2 flex-shrink-0 flex-grow-0" style={{ width: "6rem" }}>
        {exam.student.id}
      </div>
      <div className="p-2 flex-shrink-0">
        {`${exam.student.firstName} ${exam.student.lastName}`}
      </div>
      <div className="p-2 flex-grow flex-shrink-0 text-gray-400">
        {exam.error?.message}
      </div>
    </div>
  );
}
