import type { Plugin } from 'vite';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Dev-only furniture-detection endpoint for the import lab (#/lab).
 * POST /api/detect { imageBase64, mediaType, gridWidth, gridHeight }
 *   -> { items: [...], usage, ms }
 *
 * Runs server-side in the vite dev process so credentials never reach the
 * browser. The zero-arg SDK client resolves ANTHROPIC_API_KEY or an
 * `ant auth login` profile automatically. The hosted product will do this
 * behind its own API; self-hosters bring their own key (PROJECT.md).
 */

const MODEL = 'claude-opus-5';

const SYSTEM = `You analyze top-down fantasy battle-map images for a virtual tabletop and
locate furniture so it can be replaced with 3D props. You answer with a single
JSON array and nothing else.`;

function userPrompt(gridWidth: number, gridHeight: number): string {
  return `This map image covers exactly a ${gridWidth} x ${gridHeight} grid of squares.
Coordinates: x runs left to right from 0 to ${gridWidth}; z runs top to bottom from 0 to ${gridHeight}.
Units are grid squares; decimals are allowed and encouraged for accurate centers.

Identify every piece of FURNITURE visible in the image using ONLY this vocabulary:
- "table"  (include "shape": "rect" or "round")
- "seat"   (include "style": "stool", "chair", or "bench")
- "barrel"
- "crate"
- "chest"

Ignore walls, doors, floors, rugs, stairs, light sources (candles, torches, fireplaces),
plants, food, dishes, small clutter, and decals.

Return ONLY a JSON array. Each element:
{"kind": "...", "x": <center-x>, "z": <center-z>, "w": <width in squares>, "d": <depth in squares>, "rotationDeg": <0|45|90|135>, "confidence": <0..1>}
plus "shape" for tables and "style" for seats.

List every instance separately (a table and its four chairs = five items). If an
object resembles the vocabulary but you are unsure, pick the closest kind and
lower the confidence.`;
}

function extractJsonArray(text: string): unknown[] | null {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readBody(req: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

export function detectApi(): Plugin {
  return {
    name: '3dvtt-detect-api',
    configureServer(server) {
      server.middlewares.use('/api/detect', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        void (async () => {
          const started = Date.now();
          try {
            const body = JSON.parse(await readBody(req)) as {
              imageBase64: string;
              mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
              gridWidth: number;
              gridHeight: number;
            };

            const client = new Anthropic();
            const response = await client.beta.messages.create({
              model: MODEL,
              max_tokens: 16000,
              // Skill guidance: opt into server-side refusal fallbacks by
              // default on opus-5 requests.
              betas: ['server-side-fallback-2026-07-01'],
              fallbacks: 'default',
              system: SYSTEM,
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'image',
                      source: {
                        type: 'base64',
                        media_type: body.mediaType,
                        data: body.imageBase64,
                      },
                    },
                    { type: 'text', text: userPrompt(body.gridWidth, body.gridHeight) },
                  ],
                },
              ],
            });

            if (response.stop_reason === 'refusal') {
              res.statusCode = 502;
              res.end(JSON.stringify({ error: 'model declined the request' }));
              return;
            }

            const text = response.content
              .filter((b): b is Anthropic.TextBlock => b.type === 'text')
              .map((b) => b.text)
              .join('\n');
            const items = extractJsonArray(text);
            if (!items) {
              res.statusCode = 502;
              res.end(JSON.stringify({ error: 'response was not a JSON array', raw: text }));
              return;
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                items,
                ms: Date.now() - started,
                usage: {
                  input: response.usage.input_tokens,
                  output: response.usage.output_tokens,
                },
              }),
            );
          } catch (e) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            const message = e instanceof Error ? e.message : String(e);
            const hint =
              e instanceof Anthropic.AuthenticationError || /api key|auth/i.test(message)
                ? ' — set ANTHROPIC_API_KEY in the shell running `pnpm dev`, or `ant auth login`'
                : '';
            res.end(JSON.stringify({ error: message + hint }));
          }
        })();
      });
    },
  };
}
