const Str = (x) => {
  try {
    return String(x);
  } catch (e) {
    return String(e);
  }
};

const stringify = (x) => {
  try {
    return JSON.stringify(x);
  } catch {
    return Str(x);
  }
};

const url =
  "https://script.google.com/macros/s/AKfycbzBFvLSewHPfKa0aemNWTO6PvXGhLzolyJkWlKVylPeCQNQIT3GoygE4k6pvTOYXoHC/exec";

const fetchText = async (...args) => (await fetch(...args)).text();

const langCache = {};
export const fixText = async function fixText(
  text,
  sourceLang = "detect",
  targetLang = "en",
) {
  if (!text?.trim?.()) {
    return text;
  }
  text = text.trim();
  let out;
  try {
    if (localStorage.getItem(text)) return localStorage.getItem(text);
    if (langCache[text]) return JSON.parse(await langCache[text]).textOut;
    const payload = { text };
    payload.sourceLang = sourceLang;
    payload.targetLang = targetLang;
    langCache[text] = fetchText(`${url}`, {
      method: "POST",
      body: encodeURIComponent(stringify(payload)),
    });
    responsePayload = JSON.parse(await langCache[text]);
    out = responsePayload.textOut;
    //console.log({text},{responsePayload});
  } catch (e) {
    console.warn(e);
  }
  if (out?.trim?.() && out?.trim?.() !== "#ERROR!" && out != text) {
    localStorage.setItem(text, out);
  } else {
    delete langCache[text];
  }
  return out || text;
};
