const { expect } = require("@jest/globals");
const listAllExams = require("../api/listAllExams");

describe("mergeAndDeduplicate", () => {
  it("should include exams from both arrays, but no duplicates", () => {
    const array1 = [{ fileId: "1" }, { fileId: "2" }, { fileId: "1" }];
    const result = listAllExams.mergeAndDeduplicate(array1);
    expect(result).toEqual([{ fileId: "1" }, { fileId: "2" }]);
  });
});
