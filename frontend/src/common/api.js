import { useMutation, useQuery, useQueryClient } from "react-query";
import { assert } from "./utils";

export class ApiError extends Error {
  constructor({ type, statusCode, message, details }) {
    super(message);
    this.type = type;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export async function apiClient(
  endpoint,
  { method, ignoreNotFound, body } = {}
) {
  const config = {
    method: method || "GET",
  };

  // Add body and headers to request if needed
  if (body !== undefined) {
    assert(
      ["POST", "PUT"].indexOf(method) >= 0,
      "Param body can only be sent with POST or PUT requests"
    );
    config.body = JSON.stringify(body);
    config.headers = {
      "Content-Type": "application/json",
    };
  }

  const response = await window.fetch(`/scanned-exams/api/${endpoint}`, config);
  const data = await response.json();

  if (ignoreNotFound && response.status === 404) {
    return null;
  }

  if (!response.ok || data.error) {
    if (typeof data.error === "object") {
      // Throw API specific errors
      throw new ApiError({
        ...data.error, // Apply the error object as is (see error.js in backend)
      });
    } else {
      // Throw general errors
      throw new Error(data.message);
    }
  }

  return data;
}

/** Fetches the API to get information about the setup of a given course */
export function useCourseSetup(courseId) {
  return useQuery(["course", courseId, "setup"], () =>
    apiClient(`courses/${courseId}/setup`)
  );
}

/** Fetches the API to get information about the setup of a given course */
export function useCourseImportStatus(courseId, options = {}) {
  const client = useQueryClient();
  return useQuery(
    ["course", courseId, "import", "status"],
    () => apiClient(`courses/${courseId}/import/status`),
    {
      onSuccess({ status } = {}) {
        client.invalidateQueries(["course", courseId, "import", "status"]);
        options.onSuccess?.(status);
      },
    }
  );
}

/** Fetches the API to get information about the exams of a given course */
export function useCourseExams(courseId) {
  return useQuery(["course", courseId, "exams"], () =>
    apiClient(`courses/${courseId}/exams`)
  );
}

/** Performs one action to change the setup of a course */
export function useMutateCourseSetup(courseId, action, options = {}) {
  const client = useQueryClient();

  return useMutation(
    () =>
      apiClient(`courses/${courseId}/setup/${action}`, {
        method: "POST",
      }),
    {
      ...options,
      onSuccess() {
        client.invalidateQueries(["course", courseId, "setup"]);
        options.onSuccess?.();
      },
    }
  );
}

/** Start an import */
export function useMutateImportStart(courseId, examsToImport, options = {}) {
  const client = useQueryClient();

  return useMutation(
    () =>
      apiClient(`courses/${courseId}/import/start`, {
        method: "POST",
        body: examsToImport.map((exam) => exam.id),
      }),
    {
      ...options,
      // Passes status object from API as data to callback
      onSuccess(data) {
        client.invalidateQueries(["course", courseId, "setup"]);
        options.onSuccess?.(data);
      },
    }
  );
}

/**
 * Fetches the API to get information about the current user.
 *
 * If the user is logged out, field "data" will be null
 */
export function useUser() {
  return useQuery("user", () => apiClient(`me`, { ignoreNotFound: true }));
}
