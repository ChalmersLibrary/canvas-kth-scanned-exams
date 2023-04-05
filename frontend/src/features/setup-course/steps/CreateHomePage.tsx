import React from "react";
import { H2, PrimaryButton, SecondaryButton, P } from "../../widgets";
import { useMutateCourseSetup } from "../../../common/api";

export default function CreateHomePage({ onDone, courseId }: any) {
  const mutation = useMutateCourseSetup(courseId, "create-homepage", {
    onSuccess() {
      setTimeout(onDone, 500);
    },
  });

  const { mutate, isLoading, isSuccess, isError } = mutation;

  if (isError) {
    throw mutation.error;
  }

  return (
    <div className="max-w-2xl">
      <H2>Prepare the homepage</H2>
      <P>
        The exam room will be visible for your students, it is important that
        they can see its purpose from the homepage. You can use our recommended
        homepage or setup the exam room by yourself.
      </P>
      <P>
        <em>The examroom will not be published yet.</em>
      </P>
      <div className="mt-8">
        <PrimaryButton
          disabled
          className="sm:w-96"
          onClick={mutate}
          waiting={isLoading}
          success={isSuccess}
        >
          Use recommended homepage (disabled)
        </PrimaryButton>
        <SecondaryButton className="sm:w-auto" onClick={onDone}>
          Skip this step
        </SecondaryButton>
      </div>
    </div>
  );
}
