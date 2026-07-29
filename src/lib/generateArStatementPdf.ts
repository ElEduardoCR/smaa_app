import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type ARStatementInput = {
    /** Etiqueta del documento, ej "Estado de Cuenta" */
    title?: string;
    /** Fecha de emisión (ya formateada o ISO) */
    issue_date: string;
    /** Datos del cliente (de la tabla clients) */
    client: {
        business_name: string;
        rfc: string | null;
        email?: string | null;
        phone?: string | null;
        address?: string | null;
        fiscal_zip_code?: string | null;
    };
    /** Nombre de la empresa (SMAA) — sale de company_settings si lo pasas */
    company?: {
        business_name: string;
        rfc?: string;
        address?: string;
        logo_data_url?: string | null;
    };
    /** Moneda (default MXN) */
    currency?: string;
    /** Lista de partidas a incluir en el estado de cuenta */
    invoices: Array<{
        id: string;
        invoice_number: string | null;
        concept: string;
        work_date: string | null;
        invoice_date: string;
        due_date: string | null;
        gross_amount: number;
        vat_amount: number;
        net_amount: number;
        paid_amount: number;
        balance: number;
        status: 'pending' | 'partial' | 'paid' | 'cancelled';
    }>;
    /** Notas al pie (opcional) */
    notes?: string | null;
};

const fmtMoney = (n: number) =>
    `$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (iso: string | null) => {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return iso; }
};

/**
 * Genera un Estado de Cuenta (Cuentas por Cobrar) en PDF.
 * Se usa tanto desde el dashboard como desde la ruta pública /ar/[token].
 */
export const generateARStatementPDF = (data: ARStatementInput) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;
    const companyName = data.company?.business_name || 'SMAA Manufactura';

    // ------- Header -------
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(30, 41, 59);
    doc.text(companyName, margin, 18);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    if (data.company?.rfc) doc.text(`RFC: ${data.company.rfc}`, margin, 24);
    if (data.company?.address) doc.text(data.company.address, margin, 29);

    // ------- Título del documento -------
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text(data.title || 'Estado de Cuenta', pageWidth - margin, 18, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`Fecha de emisión: ${fmtDate(data.issue_date)}`, pageWidth - margin, 24, { align: 'right' });
    doc.text(`Moneda: ${data.currency || 'MXN'}`, pageWidth - margin, 29, { align: 'right' });

    // ------- Datos del cliente -------
    let cursorY = 42;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('Cliente:', margin, cursorY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(data.client.business_name, margin + 22, cursorY);

    cursorY += 6;
    doc.setTextColor(71, 85, 105);
    if (data.client.rfc) { doc.text(`RFC: ${data.client.rfc}`, margin, cursorY); cursorY += 5; }
    if (data.client.address) { doc.text(`Dirección: ${data.client.address}`, margin, cursorY); cursorY += 5; }
    if (data.client.fiscal_zip_code) { doc.text(`CP: ${data.client.fiscal_zip_code}`, margin, cursorY); cursorY += 5; }
    if (data.client.email) { doc.text(`Email: ${data.client.email}`, margin, cursorY); cursorY += 5; }
    if (data.client.phone) { doc.text(`Tel: ${data.client.phone}`, margin, cursorY); cursorY += 5; }

    // ------- Tabla de partidas -------
    const tableData = data.invoices.map((inv) => [
        inv.invoice_number || '—',
        inv.concept.length > 40 ? inv.concept.slice(0, 37) + '…' : inv.concept,
        fmtDate(inv.invoice_date),
        fmtDate(inv.due_date),
        fmtMoney(inv.gross_amount),
        fmtMoney(inv.vat_amount),
        fmtMoney(inv.net_amount),
        fmtMoney(inv.balance),
    ]);

    autoTable(doc, {
        startY: cursorY + 4,
        head: [['# Factura', 'Concepto', 'F. Factura', 'Vence', 'Bruto', 'IVA 16%', 'Total', 'Saldo']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
        columnStyles: {
            0: { cellWidth: 22 },
            1: { cellWidth: 'auto' },
            2: { cellWidth: 18, halign: 'center' },
            3: { cellWidth: 18, halign: 'center' },
            4: { cellWidth: 22, halign: 'right' },
            5: { cellWidth: 20, halign: 'right' },
            6: { cellWidth: 22, halign: 'right' },
            7: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
        },
        margin: { left: margin, right: margin },
    });

    // ------- Totales -------
    const totalGross = data.invoices.reduce((s, i) => s + Number(i.gross_amount || 0), 0);
    const totalVat = data.invoices.reduce((s, i) => s + Number(i.vat_amount || 0), 0);
    const totalNet = data.invoices.reduce((s, i) => s + Number(i.net_amount || 0), 0);
    const totalBalance = data.invoices.reduce((s, i) => s + Number(i.balance || 0), 0);

    const finalY = (doc as any).lastAutoTable?.finalY || cursorY + 30;
    let tY = finalY + 8;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text('Subtotal (Bruto):', pageWidth - margin - 60, tY);
    doc.text(fmtMoney(totalGross), pageWidth - margin, tY, { align: 'right' });
    tY += 5;
    doc.text('IVA 16%:', pageWidth - margin - 60, tY);
    doc.text(fmtMoney(totalVat), pageWidth - margin, tY, { align: 'right' });
    tY += 5;

    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.4);
    doc.line(pageWidth - margin - 60, tY - 1, pageWidth - margin, tY - 1);
    tY += 2;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('Total:', pageWidth - margin - 60, tY + 2);
    doc.text(fmtMoney(totalNet), pageWidth - margin, tY + 2, { align: 'right' });
    tY += 8;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(220, 38, 38); // rojo
    doc.text('Saldo pendiente:', pageWidth - margin - 60, tY + 2);
    doc.text(fmtMoney(totalBalance), pageWidth - margin, tY + 2, { align: 'right' });
    tY += 14;

    // ------- Notas -------
    if (data.notes) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        const lines = doc.splitTextToSize(data.notes, pageWidth - margin * 2);
        doc.text('Notas:', margin, tY);
        doc.text(lines, margin, tY + 4);
    }

    // ------- Footer -------
    const footerY = doc.internal.pageSize.getHeight() - 12;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
        `Documento generado el ${new Date().toLocaleString('es-MX')} — ${companyName}`,
        pageWidth / 2,
        footerY,
        { align: 'center' }
    );

    // Abrir en nueva pestaña
    const filename = `estado-cuenta-${(data.client.business_name || 'cliente').replace(/[^\w-]+/g, '_')}-${data.issue_date}.pdf`;
    doc.save(filename);
};
