import html from "../page.html?raw";
export const dynamic = "force-dynamic";
export function GET() { return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }); }
