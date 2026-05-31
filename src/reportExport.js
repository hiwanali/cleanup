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

  function adminReportToExport(adminReport) {
    const { meta, summary } = adminReport;
    const periodLabel = meta.label || '';
    const sheets = [
      {
        name: 'Sammanfattning',
        headers: ['Mätvärde', 'Värde'],
        rows: [
          { Mätvärde: 'Period', Värde: periodLabel },
          { Mätvärde: 'Städade timmar totalt', Värde: summary.totalHours },
          { Mätvärde: 'Avvikelser totalt', Värde: summary.totalIncidents },
          { Mätvärde: 'Justerade tider', Värde: summary.totalTimeAdjusted },
          { Mätvärde: 'Sjukanmälan totalt', Värde: summary.totalSickReports },
          { Mätvärde: 'Nya tider av kund', Värde: summary.customerNewTimes },
          { Mätvärde: 'Notis', Värde: summary.customerNewTimesNote },
        ],
      },
      {
        name: 'Per kund',
        headers: ['Kund', 'Timmar', 'Antal pass'],
        rows: adminReport.byCustomer.map(r => ({ Kund: r.name, Timmar: r.hours, 'Antal pass': r.shiftCount })),
      },
      {
        name: 'Per objekt',
        headers: ['Kund', 'Objekt', 'Timmar', 'Antal pass'],
        rows: adminReport.byProperty.map(r => ({
          Kund: r.customerName,
          Objekt: r.name,
          Timmar: r.hours,
          'Antal pass': r.shiftCount,
        })),
      },
      {
        name: 'Per städare',
        headers: ['Städare', 'Timmar', 'Antal pass'],
        rows: adminReport.byCleaner.map(r => ({ Städare: r.name, Timmar: r.hours, 'Antal pass': r.shiftCount })),
      },
      {
        name: 'Sjukanmälan',
        headers: ['Städare', 'Antal sjukanmälan'],
        rows: adminReport.sickByCleaner.map(r => ({ Städare: r.name, 'Antal sjukanmälan': r.count })),
      },
    ];

    const pdfSections = [
      {
        title: 'Sammanfattning',
        headers: ['Mätvärde', 'Värde'],
        rows: sheets[0].rows,
      },
      { title: 'Per kund', headers: ['Kund', 'Timmar', 'Pass'], rows: sheets[1].rows.map(r => ({ Kund: r.Kund, Timmar: r.Timmar, Pass: r['Antal pass'] })) },
      { title: 'Per objekt', headers: ['Kund', 'Objekt', 'Timmar'], rows: sheets[2].rows.map(r => ({ Kund: r.Kund, Objekt: r.Objekt, Timmar: r.Timmar })) },
      { title: 'Per städare', headers: ['Städare', 'Timmar', 'Pass'], rows: sheets[3].rows.map(r => ({ Städare: r.Städare, Timmar: r.Timmar, Pass: r['Antal pass'] })) },
      { title: 'Sjukanmälan', headers: ['Städare', 'Antal'], rows: sheets[4].rows.map(r => ({ Städare: r.Städare, Antal: r['Antal sjukanmälan'] })) },
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
          { Mätvärde: 'Bokade tider', Värde: summary.bookedCount },
          { Mätvärde: 'Arbetade timmar', Värde: summary.workedHours },
          { Mätvärde: 'Antal städare', Värde: summary.cleanerCount },
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
