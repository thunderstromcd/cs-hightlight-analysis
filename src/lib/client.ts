export function fileHref(id: string): string {
  return `/api/exports/${id}/file`;
}

export async function api(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin" });
  if (response.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event("chaipian-auth"));
  }
  return response;
}

export type UploadDemoProgress = {
  percent: number;
  loaded: number;
  total: number;
};

/** POST /api/demos with XMLHttpRequest so upload.onprogress can show 1GB transfers. */
export function uploadDemo(
  file: File,
  onProgress?: (progress: UploadDemoProgress) => void,
): Promise<{ ok: boolean; status: number; demo?: unknown; message?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const body = new FormData();
    body.set("file", file);
    xhr.open("POST", "/api/demos");
    xhr.upload.onprogress = (event) => {
      if (!onProgress) return;
      const total = event.lengthComputable ? event.total : file.size;
      const loaded = event.loaded;
      const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100))) : 0;
      onProgress({ percent, loaded, total });
    };
    xhr.onerror = () => reject(new Error("上传没有完成。确认这是 .dem，并且服务还开着。"));
    xhr.onload = () => {
      let payload: { demo?: unknown; message?: string } = {};
      try {
        payload = JSON.parse(xhr.responseText) as { demo?: unknown; message?: string };
      } catch {
        payload = {};
      }
      if (xhr.status === 401 && typeof window !== "undefined") {
        window.dispatchEvent(new Event("chaipian-auth"));
      }
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        demo: payload.demo,
        message: payload.message,
      });
    };
    xhr.send(body);
  });
}
