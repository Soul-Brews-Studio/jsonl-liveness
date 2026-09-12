import { expect, test } from "bun:test";
import { initialTheme } from "./theme";

test("Paper is the default when no valid theme preference exists",()=>{
  expect(initialTheme(null)).toBe("paper");
  expect(initialTheme("")).toBe("paper");
  expect(initialTheme("unknown")).toBe("paper");
});

test("an explicit saved theme choice is preserved",()=>{
  expect(initialTheme("dark")).toBe("dark");
  expect(initialTheme("vangogh")).toBe("vangogh");
  expect(initialTheme("paper")).toBe("paper");
});
