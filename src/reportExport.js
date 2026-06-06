/**
 * Export av rapporter till Excel (.xlsx) och PDF.
 * Kräver SheetJS (XLSX) och jsPDF + autotable via CDN i CleanUp.html.
 */
(function () {
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Kunde inte ladda ${src}`));
      document.head.appendChild(s);
    });
  }

  async function ensureXlsx() {
    if (window.XLSX) return window.XLSX;
    await loadScript('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js');
    return window.XLSX;
  }

  async function ensurePdf() {
    if (window.jspdf?.jsPDF) {
      if (!window.jspdf?.jsPDF?.API?.autoTable && !document.querySelector('script[data-jspdf-autotable]')) {
        await loadScript('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js');
      }
      return window.jspdf.jsPDF;
    }
    await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js');
    await loadScript('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js');
    return window.jspdf.jsPDF;
  }

  function aoaFromRows(headers, rows) {
    return [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))];
  }

  async function exportReportXlsx({ filename, sheets }) {
    const XLSX = await ensureXlsx();
    const wb = XLSX.utils.book_new();
    sheets.forEach(({ name, headers, rows }) => {
      const data = aoaFromRows(headers, rows);
      const ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
    });
    XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
  }

  function exportCsvFallback({ filename, headers, rows }) {
    const esc = v => {
      const s = String(v ?? '');
      return s.includes(';') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const lines = [
      headers.map(esc).join(';'),
      ...rows.map(r => headers.map(h => esc(r[h])).join(';')),
    ];
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function exportReportPdf({ filename, title, subtitle, sections }) {
    const jsPDF = await ensurePdf();
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    let y = 14;

    doc.setFontSize(16);
    doc.text(title, 14, y);
    y += 8;
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(subtitle, 14, y);
    y += 10;
    doc.setTextColor(0);

    sections.forEach((section, idx) => {
      if (idx > 0 && y > 250) {
        doc.addPage();
        y = 14;
      }
      doc.setFontSize(12);
      doc.text(section.title, 14, y);
      y += 4;
      doc.autoTable({
        startY: y,
        head: [section.headers],
        body: section.rows.map(r => section.headers.map(h => String(r[h] ?? ''))),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [30, 80, 184] },
        margin: { left: 14, right: 14 },
      });
      y = doc.lastAutoTable.finalY + 10;
    });

    doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
  }

  function shiftDetailExportRows(rows) {
    return rows.map(r => ({
      Datum: r.date,
      Kund: r.customerName,
      Objekt: r.propertyName,
      Städare: r.cleanerName,
      Status: r.status,
      'Planerad start': r.plannedStart,
      'Planerad slut': r.plannedEnd,
      'Faktisk start': r.actualStart,
      'Faktisk slut': r.actualEnd,
      'Planerade timmar': r.plannedHours,
      'Arbetade timmar': r.workedHours,
    }));
  }

  const SHIFT_DETAIL_HEADERS = [
    'Datum', 'Kund', 'Objekt', 'Städare', 'Status',
    'Planerad start', 'Planerad slut', 'Faktisk start', 'Faktisk slut',
    'Planerade timmar', 'Arbetade timmar',
  ];

  function adminReportToExport(adminReport) {
    const { meta, summary } = adminReport;
    const periodLabel = meta.label || '';
    const filterLabel = meta.filterLabel || '';

    const summaryRows = [
      { Mätvärde: 'Period', Värde: periodLabel },
      { Mätvärde: 'Filter', Värde: filterLabel },
      { Mätvärde: 'Arbetade timmar (utfört)', Värde: summary.totalHours },
      { Mätvärde: 'Planerade timmar (bokade pass)', Värde: summary.totalPlannedHours },
      { Mätvärde: 'Utförda pass', Värde: summary.shiftCountWorked },
      { Mätvärde: 'Bokade pass', Värde: summary.shiftCountBooked },
      { Mätvärde: 'Kommande godkända', Värde: summary.shiftCountPlanned },
      { Mätvärde: 'Sjuka pass', Värde: summary.shiftCountSick },
      { Mätvärde: 'Planerade timmar (sjuka)', Värde: summary.sickPlannedHours },
      { Mätvärde: 'Avbokade pass', Värde: summary.shiftCountCancelled },
      { Mätvärde: 'Borttagna pass', Värde: summary.shiftCountDeleted },
      { Mätvärde: 'Pausade (ledighet)', Värde: summary.shiftCountPaused },
      { Mätvärde: 'Avvikelser', Värde: summary.totalIncidents },
      { Mätvärde: 'Justerade tider', Värde: summary.totalTimeAdjusted },
      { Mätvärde: 'Sjukanmälan (händelser)', Värde: summary.totalSickReports },
    ];

    const detailRows = shiftDetailExportRows(adminReport.shiftDetails || []);
    const sickRows = shiftDetailExportRows(adminReport.sickShifts || []);
    const deletedRows = shiftDetailExportRows(adminReport.deletedShifts || []);
    const cancelledRows = shiftDetailExportRows(adminReport.cancelledShifts || []);

    const sheets = [
      { name: 'Sammanfattning', headers: ['Mätvärde', 'Värde'], rows: summaryRows },
      {
        name: 'Passdetaljer',
        headers: SHIFT_DETAIL_HEADERS,
        rows: detailRows,
      },
      {
        name: 'Per kund',
        headers: ['Kund', 'Arbetade timmar', 'Antal utförda'],
        rows: adminReport.byCustomer.map(r => ({
          Kund: r.name,
          'Arbetade timmar': r.hours,
          'Antal utförda': r.shiftCount,
        })),
      },
      {
        name: 'Per objekt',
        headers: ['Kund', 'Objekt', 'Arbetade timmar', 'Antal utförda'],
        rows: adminReport.byProperty.map(r => ({
          Kund: r.customerName,
          Objekt: r.name,
          'Arbetade timmar': r.hours,
          'Antal utförda': r.shiftCount,
        })),
      },
      {
        name: 'Per städare',
        headers: ['Städare', 'Arbetade timmar', 'Antal utförda'],
        rows: adminReport.byCleaner.map(r => ({
          Städare: r.name,
          'Arbetade timmar': r.hours,
          'Antal utförda': r.shiftCount,
        })),
      },
      {
        name: 'Sjuka pass',
        headers: SHIFT_DETAIL_HEADERS,
        rows: sickRows,
      },
      {
        name: 'Sjukanmälan',
        headers: ['Städare', 'Antal pass', 'Planerade timmar'],
        rows: adminReport.sickByCleaner.map(r => ({
          Städare: r.name,
          'Antal pass': r.count,
          'Planerade timmar': r.plannedHours || 0,
        })),
      },
      {
        name: 'Borttagna pass',
        headers: SHIFT_DETAIL_HEADERS,
        rows: deletedRows,
      },
      {
        name: 'Avbokade pass',
        headers: SHIFT_DETAIL_HEADERS,
        rows: cancelledRows,
      },
    ];

    const pdfSections = [
      { title: 'Sammanfattning', headers: ['Mätvärde', 'Värde'], rows: summaryRows },
      { title: 'Per kund', headers: ['Kund', 'Timmar', 'Pass'], rows: sheets[2].rows },
      { title: 'Per städare', headers: ['Städare', 'Timmar', 'Pass'], rows: sheets[4].rows },
      { title: 'Sjuka pass', headers: ['Datum', 'Kund', 'Städare', 'Timmar'], rows: sickRows.map(r => ({
        Datum: r.Datum, Kund: r.Kund, Städare: r.Städare, Timmar: r['Planerade timmar'],
      })) },
    ];

    return { sheets, pdfSections, periodLabel };
  }

  function customerReportToExport(customerReport) {
    const { meta, summary } = customerReport;
    const periodLabel = meta.label || '';
    const sheets = [
      {
        name: 'Sammanfattning',
        headers: ['Mätvärde', 'Värde'],
        rows: [
          { Mätvärde: 'Kund', Värde: meta.customerName },
          { Mätvärde: 'Period', Värde: periodLabel },
          { Mätvärde: 'Bokade pass', Värde: summary.bookedCount },
          { Mätvärde: 'Planerade timmar', Värde: summary.plannedHours },
          { Mätvärde: 'Arbetade timmar', Värde: summary.workedHours },
          { Mätvärde: 'Antal städare', Värde: summary.cleanerCount },
          { Mätvärde: 'Sjuka pass', Värde: summary.sickCount },
          { Mätvärde: 'Avbokade pass', Värde: summary.cancelledCount },
          { Mätvärde: 'Reklamationer', Värde: summary.incidentsCount },
        ],
      },
    ];
    const pdfSections = [
      { title: 'Sammanfattning', headers: ['Mätvärde', 'Värde'], rows: sheets[0].rows },
    ];
    return { sheets, pdfSections, periodLabel };
  }

  window.ReportExport = {
    exportReportXlsx,
    exportReportPdf,
    exportCsvFallback,
    adminReportToExport,
    customerReportToExport,
    ensureXlsx,
    ensurePdf,
  };
})();
