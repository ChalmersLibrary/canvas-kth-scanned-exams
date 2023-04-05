import React from "react";

export default function UnauthenticatedApp({ courseId }: any) {
  return (
    <div className="max-w-screen-lg">
      <div className="text-4xl font-semibold mt-8 mb-4 tracking-tight">
        Import Scanned Exams
      </div>
      <p className="my-6 text-xl">
        If you have conducted a written exam on paper and want to use SpeedGrader for the assessment,
        you can import the scanned exams to Canvas by using this app.
      </p>
      <p className="my-6">
        This app requires you to have a <b>teacher role</b> in this exam room.
      </p>
      <p className="my-6">
        Please make sure that the exam administration is made aware well in advance of the exams being 
        assessed in Canvas and not on paper, since this impacts the administrative process. If you have 
        any questions, please contact <a className="text-blue-500 no-underline hover:text-blue-700 hover:underline" href="mailto:canvas@chalmers.se">canvas@chalmers.se</a>!
      </p>
      <div className="bg-blue-100 p-6 my-12 flex flex-row items-center justify-center">
        <form method="post" action="/scanned-exams/auth">
          <input name="courseId" type="hidden" value={courseId} />
          <button
            type="submit"
            className="bg-blue-500 text-white rounded-md font-semibold w-56 py-2 hover:bg-blue-700 transition-colors"
          >
            Launch app
          </button>
        </form>
      </div>
    </div>
  );
}
