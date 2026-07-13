const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5-mini";
const DEFAULT_MAX_OUTPUT_TOKENS = 12000;
const DEFAULT_REASONING_EFFORT = "low";
const MAX_REQUEST_BYTES = 18_000_000;
const MAX_IMAGE_DATA_CHARS = 16_000_000;

const LOGBOOK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rows", "warnings"],
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["row", "flightTime", "pus", "coPilot"],
        properties: {
          row: { type: "integer" },
          flightTime: { type: ["string", "null"] },
          pus: { type: ["string", "null"] },
          coPilot: { type: ["string", "null"] },
        },
      },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
  },
};

const LOGBOOK_PROMPT = `
You read a handwritten flight logbook spread from two images.

Important context:
- The left image and right image are the left and right sides of the same logbook spread.
- Cells at the same vertical height belong to the same record row.
- Read only handwritten values, not printed labels, colons, guide lines, totals, carry-over rows, or page footer totals.
- From the left image, read only the handwritten values in the FLIGHT TIME column and the PUS column.
- From the right image, read only the handwritten values in the CO-PILOT column.
- Keep rows in top-to-bottom order.
- Include only rows where at least one of FLIGHT TIME, PUS, or CO-PILOT has a handwritten value.
- Do not guess unreadable values. Use an empty string when the value is blank or unclear.
- Normalize times to H:MM when confident. For example, 1 hour 5 minutes is 1:05 and 30 minutes is 0:30.
- If a value like 130 clearly means 1:30, normalize it to 1:30 only when confident.
- If uncertain, leave the cell empty and add a short warning.
- Do not calculate totals.

Column identification rules:
- First locate the printed column headers and grid lines. Do not start by copying all visible time-like numbers.
- The expected left-image crop usually shows these columns from left to right: T/O, LDG, FLIGHT TIME, PIC, SOLO or SIC, PUS, CROSS COUNTRY, NIGHT.
- The expected right-image crop usually shows these columns from left to right: CO-PILOT, DUAL INSTRUCTION RECEIVED, CROSS COUNTRY, NIGHT, AIRCRAFT HOODED, ACTUAL INSTRUMENT, FLIGHT SIMULATOR, FLIGHT TRAINER, AS FLIGHT INSTRUCTOR.
- On the left image, FLIGHT TIME is the column immediately to the right of the T/O and LDG landing-count columns.
- On the left image, PUS is the printed column labeled "PUS" or "機長見習業務 PUS". It is between "SOLO or SIC" and "CROSS COUNTRY". Read handwritten values inside that PUS column even if the column has only a few entries.
- Do not copy values from PIC, SOLO or SIC, CROSS COUNTRY, NIGHT, T/O, or LDG into PUS.
- If a handwritten value is inside the vertical grid lines of the PUS column, return it as pus. PUS may have only one or a few handwritten entries on the page, but those entries are important.
- Do not leave PUS empty just because most PUS cells are blank. Read the visible handwritten values in the PUS column.
- On the right image, CO-PILOT must come from the printed CO-PILOT header column only. In this crop, CO-PILOT is normally the first full time column on the right-page image, immediately under the "CO-PILOT" printed header.
- The right image may also contain CROSS COUNTRY, NIGHT, INSTRUMENT, SIMULATOR, or similar columns. Values in those columns are NOT coPilot values.
- Be especially careful not to copy INSTRUMENT time into coPilot. This means: ignore the handwriting in the INSTRUMENT columns when filling coPilot. It does NOT mean the whole row's coPilot should be blank.
- A row may contain both a valid CO-PILOT value and a separate INSTRUMENT value. In that case, read the CO-PILOT value from the CO-PILOT column and ignore the INSTRUMENT value.
- Determine the vertical boundaries of the CO-PILOT column from the printed header and the ruled grid. A value belongs to CO-PILOT if the handwriting is inside those boundaries.
- Do not use "the value looks equal to flight time" as the main evidence that it is CO-PILOT. Column position is more important. However, if a value is visibly inside the CO-PILOT column, read it even if nearby CROSS COUNTRY or INSTRUMENT columns also contain time-like values.
- Do not leave CO-PILOT empty when the first right-page CO-PILOT column visibly contains handwritten time values.
- If a column header is cropped, tilted, or hard to read, use nearby printed labels and grid boundaries, but stay conservative.

Return JSON only in this shape:
{
  "rows": [
    {
      "row": 1,
      "flightTime": "1:54",
      "pus": "",
      "coPilot": "1:54"
    }
  ],
  "warnings": []
}
`.trim();

export default {
  async fetch(request, env) {
    const corsHeaders = createCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (!isOriginAllowed(request, env)) {
      return jsonResponse(
        {
          ok: false,
          error: "このページからのアクセスは許可されていません。",
        },
        403,
        corsHeaders,
      );
    }

    if (request.method !== "POST") {
      return jsonResponse(
        {
          ok: false,
          error: "POSTリクエストだけを受け付けます。",
        },
        405,
        corsHeaders,
      );
    }

    if (!env.OPENAI_API_KEY) {
      return jsonResponse(
        {
          ok: false,
          error: "WorkerのOPENAI_API_KEY設定が見つかりません。",
        },
        500,
        corsHeaders,
      );
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      return jsonResponse(
        {
          ok: false,
          error: "画像サイズが大きすぎます。少し小さくしてから試してください。",
        },
        413,
        corsHeaders,
      );
    }

    try {
      const payload = await request.json();
      validatePayload(payload);

      const openAiResponse = await callOpenAI(payload, env);
      const text = extractOutputText(openAiResponse);
      const data = normalizeResult(parseOpenAIJson(text));

      return jsonResponse(
        {
          ok: true,
          data,
        },
        200,
        corsHeaders,
      );
    } catch (error) {
      console.error("Logbook worker error:", error?.message || error);

      return jsonResponse(
        {
          ok: false,
          error: safeErrorMessage(error),
          debug: error?.debug || undefined,
        },
        error?.status || 500,
        corsHeaders,
      );
    }
  },
};

async function callOpenAI(payload, env) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 70_000);

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || DEFAULT_MODEL,
        store: false,
        max_output_tokens: readPositiveInteger(env.OPENAI_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS),
        reasoning: {
          effort: env.OPENAI_REASONING_EFFORT || DEFAULT_REASONING_EFFORT,
        },
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: LOGBOOK_PROMPT,
              },
              {
                type: "input_image",
                image_url: payload.leftImage,
              },
              {
                type: "input_image",
                image_url: payload.rightImage,
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "logbook_reading",
            strict: true,
            schema: LOGBOOK_SCHEMA,
          },
        },
      }),
    });

    if (!response.ok) {
      throw createError(openAIStatusMessage(response.status), response.status);
    }

    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createError("読み取りがタイムアウトしました。もう一度試してください。", 504);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw createError("画像データが見つかりません。", 400);
  }

  if (!isDataImage(payload.leftImage) || !isDataImage(payload.rightImage)) {
    throw createError("左画像と右画像を両方選択してください。", 400);
  }

  const imageSize = payload.leftImage.length + payload.rightImage.length;
  if (imageSize > MAX_IMAGE_DATA_CHARS) {
    throw createError("画像サイズが大きすぎます。少し小さくしてから試してください。", 413);
  }
}

function isDataImage(value) {
  return typeof value === "string" && /^data:image\/(jpeg|jpg|png|webp|gif);base64,/.test(value);
}

function extractOutputText(response) {
  if (response?.output_parsed && typeof response.output_parsed === "object") {
    return JSON.stringify(response.output_parsed);
  }

  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const jsonString = findJsonString(response);
  if (jsonString) {
    return jsonString;
  }

  const text = response?.output
    ?.flatMap((item) => item.content || [])
    ?.find((content) => content.type === "output_text" || typeof content.text === "string")
    ?.text;

  if (typeof text === "string" && text.trim()) {
    return text;
  }

  if (response?.status && response.status !== "completed") {
    if (response?.status === "incomplete" && response?.incomplete_details?.reason === "max_output_tokens") {
      throw createError(
        "OpenAIの出力上限に達しました。WorkerのOPENAI_MAX_OUTPUT_TOKENSを増やすか、画像を少し小さくしてください。",
        502,
        describeOpenAIResponse(response),
      );
    }

    throw createError(
      `OpenAIの応答が完了しませんでした。status: ${response.status}`,
      502,
      describeOpenAIResponse(response),
    );
  }

  throw createError(
    "OpenAIから読み取りJSONが返りませんでした。",
    502,
    describeOpenAIResponse(response),
  );
}

function parseOpenAIJson(text) {
  const cleanedText = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(cleanedText);
  } catch {
    throw createError("OpenAIからJSON形式ではない応答が返りました。", 502);
  }
}

function findJsonString(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (text.startsWith("{") && text.includes('"rows"') && text.includes('"warnings"')) {
      return text;
    }
    return "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJsonString(item, depth + 1);
      if (found) {
        return found;
      }
    }
    return "";
  }

  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      const found = findJsonString(item, depth + 1);
      if (found) {
        return found;
      }
    }
  }

  return "";
}

function describeOpenAIResponse(response) {
  return {
    status: response?.status || null,
    incompleteDetails: response?.incomplete_details || null,
    outputTypes: Array.isArray(response?.output)
      ? response.output.map((item) => ({
          type: item?.type || null,
          status: item?.status || null,
          role: item?.role || null,
          contentTypes: Array.isArray(item?.content)
            ? item.content.map((content) => ({
                type: content?.type || null,
                hasText: typeof content?.text === "string" && content.text.length > 0,
                textLength: typeof content?.text === "string" ? content.text.length : 0,
              }))
            : [],
        }))
      : [],
  };
}

function normalizeResult(result) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];

  return {
    rows: rows.map((row, index) => ({
      row: Number.isInteger(row.row) ? row.row : index + 1,
      flightTime: normalizeCell(row.flightTime),
      pus: normalizeCell(row.pus),
      coPilot: normalizeCell(row.coPilot),
    })),
    warnings: warnings.map((warning) => String(warning)),
  };
}

function normalizeCell(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function createCorsHeaders(request, env) {
  const configuredOrigin = env.ALLOWED_ORIGIN || "*";
  const allowedOrigin = configuredOrigin === "*" ? "*" : configuredOrigin;

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function isOriginAllowed(request, env) {
  const configuredOrigin = env.ALLOWED_ORIGIN || "*";
  const requestOrigin = request.headers.get("Origin");

  return configuredOrigin === "*" || !requestOrigin || requestOrigin === configuredOrigin;
}

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function createError(message, status, debug) {
  const error = new Error(message);
  error.status = status;
  error.debug = debug;
  return error;
}

function openAIStatusMessage(status) {
  if (status === 400 || status === 404) {
    return "OpenAI APIへのリクエスト形式、またはOPENAI_MODELの値を確認してください。";
  }

  if (status === 401) {
    return "OpenAI APIキーが正しくないか、WorkerのSecret設定が反映されていません。";
  }

  if (status === 403) {
    return "OpenAI APIのProject設定、モデル利用権限、または課金設定を確認してください。";
  }

  if (status === 429) {
    return "OpenAI APIの残高、月間上限、またはレート制限に当たっている可能性があります。";
  }

  if (status >= 500) {
    return "OpenAI API側で一時的なエラーが起きています。少し待ってから試してください。";
  }

  return "画像の読み取りに失敗しました。もう一度撮影して試してください。";
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function safeErrorMessage(error) {
  if (error?.status && typeof error.message === "string" && error.message) {
    return error.message;
  }

  return "画像の読み取りに失敗しました。もう一度撮影して試してください。";
}