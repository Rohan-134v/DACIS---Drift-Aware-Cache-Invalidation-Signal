export async function fetchJsonWithRetry(url, options = {}, retries = 2, delayMs = 750) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        if (response.status >= 500 && attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        return { ok: false, status: response.status, data: await response.json().catch(() => null) };
      }

      return { ok: true, status: response.status, data: await response.json() };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
    }
  }

  throw lastError;
}