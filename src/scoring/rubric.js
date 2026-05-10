import { readJson } from "../io/readJson.js";

export async function loadRubric(path = new URL("../../config/scoring-rubric.json", import.meta.url)) {
  return readJson(path);
}

export function getDimension(rubric, id) {
  return rubric.dimensions.find((dimension) => dimension.id === id);
}

