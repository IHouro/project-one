import $ from "jquery";
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import "../scss/custom.scss";
import { Html5Qrcode } from "html5-qrcode";

let html5QrcodeScanner: Html5Qrcode | null = null;
let currentCameraId: string | null = null;


//   Validierung: verhindert unnötige API-Aufrufe und gibt Feedback.
function validateBarcode(raw: string) {
  const val = raw.trim(); // vorher: (raw || "").trim()
  return val ? { ok: true, value: val } : { ok: false, message: "Bitte Barcode eingeben oder scannen." };
}

/* zentrale Meldungsfunktion */
function renderMessage(html: string) {
  $("#results").html(html);
}

 //  Kamera-Scan mit autostop bei Treffer.
async function startCameraScan(onResult: (code: string) => void): Promise<void> {
  const qrRegionId = "qr-reader";
  const qrEl = document.getElementById(qrRegionId); // einmalig abfragen

  try {
    const devices = await Html5Qrcode.getCameras();
    if (!devices?.length) {
      renderMessage(`<div class="alert alert-warning">Keine Kamera gefunden.</div>`);
      return;
    }

    currentCameraId = devices[0].id;
    if (!html5QrcodeScanner) html5QrcodeScanner = new Html5Qrcode(qrRegionId);
    qrEl?.classList.remove("d-none"); // optional chaining

    const config = {
      fps: 10,
      qrbox: { width: 300, height: 120 },
      experimentalFeatures: { useBarCodeDetectorIfSupported: true }
    };

    await html5QrcodeScanner.start(
      { deviceId: { exact: currentCameraId } },
      config,
      (decodedText) => {
        onResult(decodedText);
        void stopCameraScan(); // auto-stop
      },
      () => {} // Frame-Fehler ignorieren
    );
  } catch (err) {
    console.error("startCameraScan:", err);
    renderMessage(`<div class="alert alert-warning">Kamera konnte nicht gestartet werden. Berechtigungen prüfen.</div>`);
    await stopCameraScan();
  }
}

async function stopCameraScan(): Promise<void> {
  const qrRegionId = "qr-reader";
  const qrEl = document.getElementById(qrRegionId); 
  if (html5QrcodeScanner) {
    try { await html5QrcodeScanner.stop(); await html5QrcodeScanner.clear(); } catch { /* ignore */ }
    html5QrcodeScanner = null;
  }
  document.getElementById(qrRegionId)?.classList.add("d-none");
}


//   Bild-Upload
async function scanImageFileSimple(file: File): Promise<string | null> {
  const scanner = Html5Qrcode as any; // einmaliges Casting
  try {
    if (typeof scanner.scanFile === "function") {
      const result = await scanner.scanFile(file);
      if (Array.isArray(result)) return result[0]?.decodedText ?? result[0]?.text ?? null;
      return result?.decodedText ?? result?.text ?? null;
    }
  } catch {
    console.warn("scanFile failed, fallback");
  }

  // Fallback: DataURL + instanz-Methoden falls verfügbar
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("File read error"));
    reader.readAsDataURL(file);
  });

const tempId = "qr-temp";
  let tempEl = document.getElementById(tempId);
  if (!tempEl) {
    tempEl = document.createElement("div");
    tempEl.id = tempId;
    tempEl.style.position = "fixed";
    tempEl.style.left = "-10000px";
    document.body.appendChild(tempEl);
  }

  let tempScanner: Html5Qrcode | null = null;
  try {
    tempScanner = new Html5Qrcode(tempId);
    const temp = tempScanner as any;

    if (typeof temp.scanFile === "function") {
      const result = await temp.scanFile(file);
      if (Array.isArray(result)) return result[0]?.decodedText ?? result[0]?.text ?? null;
      return result?.decodedText ?? result?.text ?? null;
    }

    if (typeof temp.decodeFromImage === "function") {
      const result = await temp.decodeFromImage(undefined, dataUrl);
      return result?.decodedText ?? null;
    }
  } catch (err) {
    console.warn("image decode fallback failed", err);
  } finally {
    try { await (tempScanner as any)?.clear(); } catch {}
    tempEl?.remove();
  }

  return null;
}

  // DOMContentLoaded stellt sicher, dass Elemente existieren.
document.addEventListener("DOMContentLoaded", () => {
  const startBtn = document.getElementById("startCameraBtn") as HTMLButtonElement | null;
  const imageUpload = document.getElementById("imageUpload") as HTMLInputElement | null;

  if (startBtn) {
    startBtn.addEventListener("click", () => {
      (startBtn as HTMLButtonElement).disabled = true;
      void startCameraScan((code) => {
        ($("#barcodeInput") as any).val(code);
        $("#searchBtn").trigger("click");
        (startBtn as HTMLButtonElement).disabled = false;
      }).finally(() => { (startBtn as HTMLButtonElement).disabled = false; });
    });
  }

  if (imageUpload) {
    imageUpload.addEventListener("change", async (ev) => {
      const input = ev.target as HTMLInputElement;
      if (!input.files || input.files.length === 0) return;
      const file = input.files[0];
      renderMessage(`<div class="alert alert-info">Analysiere Bild...</div>`);
      try {
        const decoded = await scanImageFileSimple(file);
        if (decoded) { ($("#barcodeInput") as any).val(decoded); $("#searchBtn").trigger("click"); }
        else renderMessage(`<div class="alert alert-danger">Kein Barcode erkannt. Bitte Bild näher heranzoomen oder zuschneiden.</div>`);
      } catch (err) {
        console.error("imageUpload handler error:", err);
        renderMessage(`<div class="alert alert-danger">Fehler beim Lesen des Bildes.</div>`);
      } finally { input.value = ""; }
    });
  }
});

//  Search Handler: Validierung schützt API-Aufrufe.
$("#searchBtn").on("click", async () => {
  const raw = ($("#barcodeInput").val() as string) || "";
  const validation = validateBarcode(raw);
  if (!validation.ok) { renderMessage(`<div class="alert alert-warning">${validation.message}</div>`); return; }
  const barcode = validation.value!;
  try {
    renderMessage(`<div class="alert alert-info">Suche nach Produkt …</div>`);
    const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    const data = await response.json();
    if (data.status === 1) {
      const p = data.product;
      $("#results").html(`
        <div class="card p-3 shadow-sm">
          <div class="row g-3 align-items-center">
            <div class="col-12 col-md-4 text-center mb-2 mb-md-0">
              <img src="${p.image_front_url || ''}" alt="${p.product_name || ''}" class="img-fluid rounded product-image" />
              <div class="score-column mt-3">
                <div><img src="https://static.openfoodfacts.org/images/misc/nutriscore-${p.nutriscore_grade || 'e'}.svg" alt="Nutri-Score" class="score-image" /></div>
                <div class="mt-2">${["a","b","c","d","e"].includes((p.ecoscore_grade || "").toLowerCase()) ? `<img src="https://static.openfoodfacts.org/images/misc/ecoscore-${p.ecoscore_grade.toLowerCase()}.svg" alt="Eco-Score" class="score-image" />` : `<span class="small text-muted">Kein Eco-Score verfügbar</span>`}</div>
              </div>
            </div>
            <div class="col-12 col-md-8">
              <h5 class="card-title product-name">${p.product_name || "Unbekanntes Produkt"}</h5>
              <p class="mb-1"><strong>Marke:</strong> ${p.brands || "-"}</p>
              <p class="mb-1"><strong>Nährwerte pro 100g:</strong></p>
              <ul class="list-group list-group-flush">
                <li class="list-group-item d-flex justify-content-between"><span><strong>Kalorien</strong></span><span>${p.nutriments?.["energy-kcal_100g"] ?? "-"} kcal</span></li>
                <li class="list-group-item d-flex justify-content-between"><span><strong>Fett</strong></span><span>${p.nutriments?.fat_100g ?? "-"} g</span></li>
                <li class="list-group-item d-flex justify-content-between"><span><strong>Kohlenhydrate</strong></span><span>${p.nutriments?.carbohydrates_100g ?? "-"} g</span></li>
                <li class="list-group-item d-flex justify-content-between"><span><strong>Zucker</strong></span><span>${p.nutriments?.sugars_100g ?? "-"} g</span></li>
                <li class="list-group-item d-flex justify-content-between"><span><strong>Eiweiß</strong></span><span>${p.nutriments?.proteins_100g ?? "-"} g</span></li>
                <li class="list-group-item d-flex justify-content-between"><span><strong>Salz</strong></span><span>${p.nutriments?.salt_100g ?? "-"} g</span></li>
              </ul>
            </div>
          </div>
        </div>
      `);
    } else {
      renderMessage("<div class='alert alert-danger'>Produkt nicht gefunden.</div>");
    }
  } catch (error) {
    console.error("search error:", error);
    renderMessage("<div class='alert alert-danger'>Fehler bei der Abfrage.</div>");
  }
});
