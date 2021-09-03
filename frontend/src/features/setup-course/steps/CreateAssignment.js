import React from "react";
import { H2, PrimaryButton, P } from "./util";

export default function CreateAssignment({ onNext, courseId }) {
  const [stateLoading, setLoading] = React.useState(false);
  const [stateSucess, setSuccess] = React.useState(false);

  const didClick = () => {
    setLoading(true);
    setTimeout(() => {
      setSuccess(true);
      setTimeout(onNext, 500);
    }, 1000);
  };

  return (
    <div>
      <H2>Create Assignment</H2>
      <P>Now its time to publish the examroom</P>
      <P>
        <PrimaryButton
          className="sm:w-96"
          onClick={didClick}
          waiting={stateLoading}
          success={stateSucess}
        >
          Create Assignment
        </PrimaryButton>
      </P>
    </div>
  );
}
