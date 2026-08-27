import { describe, expect, it } from "vitest";
import { parseDaneaDocuments, summarizeDocuments } from "@/features/commesso/danea-ddt.js";

// XML ridotto ma con le stesse trappole del file vero: TotalWithoutTax PRIMA di
// Total, Description/Price anche dentro le righe, e un documento non-DDT.
const XML = `<?xml version="1.0"?>
<EasyfattDocuments>
  <Documents>
    <Document>
      <DocumentType>D</DocumentType>
      <Numbering>/EC</Numbering>
      <Number>1</Number>
      <Date>2026-08-05</Date>
      <CustomerName>Mario Rossi</CustomerName>
      <CustomerEmail>Mario.Rossi@Example.IT</CustomerEmail>
      <CustomField1>massari</CustomField1>
      <CustomField2>pi_3AbCdEf</CustomField2>
      <CustomField3>Consegna a scuola</CustomField3>
      <CustomField4>BAIS001</CustomField4>
      <PaymentName>04 Stripe</PaymentName>
      <FootNotes>Studente: Luca Rossi - Classe: 1A</FootNotes>
      <Rows>
        <Row>
          <Code>MXYZ2ZM/A</Code>
          <Description>iPad A16 128GB</Description>
          <Qty>1</Qty>
          <Price>409</Price>
        </Row>
        <Row>
          <Code></Code>
          <Description>Rif. Conferma d'ordine 326</Description>
          <Qty>0</Qty>
          <Price>0</Price>
        </Row>
      </Rows>
      <TotalWithoutTax>335.25</TotalWithoutTax>
      <Total>409</Total>
    </Document>
    <Document>
      <DocumentType>D</DocumentType>
      <Numbering>/EC</Numbering>
      <Number>2</Number>
      <Date>2026-08-06</Date>
      <CustomerName>Anna Bianchi</CustomerName>
      <CustomerEmail></CustomerEmail>
      <CustomField1>moro</CustomField1>
      <CustomField2>bonifico</CustomField2>
      <PaymentName>06 Bonifico</PaymentName>
      <Rows></Rows>
      <TotalWithoutTax>100</TotalWithoutTax>
      <Total>122</Total>
    </Document>
    <Document>
      <DocumentType>F</DocumentType>
      <Numbering>/FT</Numbering>
      <Number>9</Number>
      <Date>2026-08-07</Date>
      <Rows></Rows>
      <Total>999</Total>
    </Document>
  </Documents>
</EasyfattDocuments>`;

describe("parseDaneaDocuments", () => {
  const docs = parseDaneaDocuments(XML);

  it("tiene solo i DDT", () => {
    expect(docs.map((d) => d.number)).toEqual(["1", "2"]);
  });

  it("docKey e' l'identita' del documento", () => {
    expect(docs[0].docKey).toBe("/EC-1-2026-08-05");
    expect(new Set(docs.map((d) => d.docKey)).size).toBe(docs.length);
  });

  // Regressione del bug getTag: <Total> non deve agganciare <TotalWithoutTax>.
  it("legge Total, non TotalWithoutTax", () => {
    expect(docs[0].totalGross).toBe(409);
    expect(docs[1].totalGross).toBe(122);
  });

  it("le righe non sporcano la testata", () => {
    expect(docs[0].customerName).toBe("Mario Rossi");
    expect(docs[0].lines).toHaveLength(2);
    expect(docs[0].lines[0].code).toBe("MXYZ2ZM/A");
    expect(docs[0].lines[0].priceEur).toBe(409);
  });

  it("normalizza email e scarta CustomField2 non-Stripe", () => {
    expect(docs[0].customerEmail).toBe("mario.rossi@example.it");
    expect(docs[0].paymentIntent).toBe("pi_3AbCdEf");
    expect(docs[1].paymentIntent).toBe("");
  });

  it("riepiloga per portale e pagamento", () => {
    const s = summarizeDocuments(docs);
    expect(s.total).toBe(2);
    expect(s.withoutEmail).toBe(1);
    expect(s.byPortal).toContainEqual({ portale: "massari", ddt: 1 });
    expect(s.byPayment).toContainEqual({ pagamento: "06 Bonifico", ddt: 1 });
    expect(s.dateFrom).toBe("2026-08-05");
  });
});
