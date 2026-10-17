import { NextResponse } from "next/server";

export async function GET() {
  const content = `%PDF-1.4
1 0 obj << /Title (Invoice 2026) /Author (Browser Automation Agent) >> endobj
2 0 obj << /Type /Catalog /Pages 3 0 R >> endobj
3 0 obj << /Type /Pages /Kids [4 0 R] /Count 1 >> endobj
4 0 obj << /Type /Page /Parent 3 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >> endobj
5 0 obj << /Length 55 >> stream
BT
/F1 12 Tf
72 712 Td
(Invoice #INV-2026 - Total: INR 75,000 - Status: Paid) Tj
ET
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000088 00000 n 
0000000137 00000 n 
0000000196 00000 n 
0000000287 00000 n 
trailer << /Size 6 /Root 2 0 R >>
startxref
393
%%EOF`;

  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="invoice-2026.pdf"',
      "Content-Length": String(content.length),
    },
  });
}
