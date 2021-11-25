const { expect, beforeEach } = require("@jest/globals");
const canvas = require("../api/externalApis/canvasApiClient");
const { _getLadokId } = require("../api/endpointHandlers/listAllExams");
const { EndpointError } = require("../api/error");

jest.mock("../api/externalApis/canvasApiClient");

describe("listAllExams", () => {
  describe("getLadokId", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should throw EndpointError when list of ladokIds is empty", async () => {
      canvas.getAktivitetstillfalleUIDs.mockResolvedValue([]);
      let err;
      await _getLadokId(12345).catch((e) => {
        err = e;
      });

      expect(err instanceof EndpointError).toBe(true);
    });

    it("should throw EndpointError when list of ladokIds is longer than 1", async () => {
      /**
       * We currently don't support multiple aktivitetstillfällen for a given course
       */
      canvas.getAktivitetstillfalleUIDs.mockResolvedValue([1, 2]);
      let err;
      await _getLadokId(12345).catch((e) => {
        err = e;
      });

      expect(err instanceof EndpointError).toBe(true);
    });

    it("should return a single  value", async () => {
      canvas.getAktivitetstillfalleUIDs.mockResolvedValue([1]);

      const outp = await _getLadokId(12345);

      expect(outp).toBe(1);
    });
  });
});
