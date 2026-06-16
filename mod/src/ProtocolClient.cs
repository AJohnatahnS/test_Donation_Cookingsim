using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace CookingSimDonationMod
{
    // Typed client for the donation server. Every call is a coroutine using
    // UnityWebRequest, so all work stays on the Unity main thread and game API
    // calls around it are safe. Results come back through callbacks.
    public class ProtocolClient
    {
        private readonly string baseUrl;

        public ProtocolClient(string baseUrl)
        {
            this.baseUrl = baseUrl.TrimEnd('/');
        }

        public IEnumerator GetPending(Action<PendingOrder[]> onResult)
        {
            using (var req = UnityWebRequest.Get(baseUrl + "/pending"))
            {
                yield return req.SendWebRequest();

                if (IsError(req))
                {
                    Plugin.Log.LogWarning("GET /pending failed: " + req.error);
                    onResult(Array.Empty<PendingOrder>());
                    yield break;
                }

                PendingResponse resp = null;
                try { resp = JsonUtility.FromJson<PendingResponse>(req.downloadHandler.text); }
                catch (Exception e) { Plugin.Log.LogWarning("bad /pending body: " + e.Message); }

                onResult(resp?.pending ?? Array.Empty<PendingOrder>());
            }
        }

        public IEnumerator Confirm(string eventId, bool ok, Action<ConfirmResponse> onResult = null)
        {
            string body = JsonUtility.ToJson(new ConfirmRequest { eventId = eventId, ok = ok });
            return PostJson("/confirm", body, onResult);
        }

        public IEnumerator Finish(string eventId, string outcome)
        {
            string body = JsonUtility.ToJson(new FinishRequest { eventId = eventId, outcome = outcome });
            return PostJson<ConfirmResponse>("/finish", body, null);
        }

        public IEnumerator Game(string state)
        {
            string body = JsonUtility.ToJson(new GameRequest { state = state });
            return PostJson<ConfirmResponse>("/game", body, null);
        }

        public IEnumerator Kitchen(string[] tokens)
        {
            string body = JsonUtility.ToJson(new KitchenRequest { tokens = tokens });
            return PostJson<ConfirmResponse>("/kitchen", body, null);
        }

        private IEnumerator PostJson<T>(string path, string json, Action<T> onResult)
        {
            using (var req = new UnityWebRequest(baseUrl + path, "POST"))
            {
                req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
                req.downloadHandler = new DownloadHandlerBuffer();
                req.SetRequestHeader("Content-Type", "application/json");

                yield return req.SendWebRequest();

                if (IsError(req))
                {
                    Plugin.Log.LogWarning("POST " + path + " failed: " + req.error);
                    yield break;
                }

                if (onResult != null)
                {
                    T parsed = default;
                    try { parsed = JsonUtility.FromJson<T>(req.downloadHandler.text); }
                    catch (Exception e) { Plugin.Log.LogWarning("bad " + path + " body: " + e.Message); }
                    onResult(parsed);
                }
            }
        }

        private static bool IsError(UnityWebRequest req)
        {
#if UNITY_2020_1_OR_NEWER
            return req.result != UnityWebRequest.Result.Success;
#else
            return req.isNetworkError || req.isHttpError;
#endif
        }
    }
}
