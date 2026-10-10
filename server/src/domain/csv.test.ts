import {it,expect} from "vitest";
import {parseCsv} from "./csv.js";
it('preserves quoted commas, newlines and escaped quotations',()=> {
  expect(parseCsv('author,text\r\n"Smith, Ann","Great, friendly\nservice with ""care"""')).toEqual([['author','text'],['Smith, Ann','Great, friendly\nservice with "care"']]);
  expect(()=>parseCsv('text\n"unclosed')).toThrow();
});
