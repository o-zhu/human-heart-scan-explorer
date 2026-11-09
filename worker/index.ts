import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import { bundledJsonRequest } from "../server/bundled-json-v1.mjs";
import bundledJsonIndex from "../server/bundled-json-index-v1.json";
import { ultraRequest } from "../server/ultra-store.mjs";
import ultraIndex from "../server/ultra-upload-index.json";
import { fineVolumeRequest } from "../server/ultra-volume-store-v7.mjs";
import fineVolumeIndex from "../server/ultra-volume-index-v7.json";

import { comparisonBanks, comparisonDisplayUploadsEnabled } from "../server/donor-banks-v10.mjs";
import { comparisonDisplayRequest } from "../server/comparison-display-store-v10.mjs";
import comparisonDisplayIndex from "../server/comparison-display-index-v10.json";
import { nativeSurfaceRequest, nativeSurfaceUploadsEnabled } from "../server/native-surface-store-v20.mjs";
import nativeSurfaceIndex from "../server/native-surface-index-v20.json";
import { guidedNativeRequest, guidedNativeUploadsEnabled } from "../server/guided-native-store-v21.mjs";
import { fineDetailRequest, fineDetailUploadsEnabled, fineDetailPublicServingEnabled } from "../server/fine-detail-store-v23.mjs";
import fineDetailIndex from "../server/fine-detail-index-v23.json";
import { motionCTRequest, motionCTUploadsEnabled } from "../server/motion-ct-store-v24.mjs";
import motionCTIndex from "../server/motion-ct-index-v24.json";
import { cleanupStaticAliasRequest } from "../server/cleanup-static-alias-v28.mjs";
import cleanupStaticAliasIndex from "../server/cleanup-static-alias-index-v28.json";
import { displayCompactRequest, displayCompactUploadsEnabled, displayCompactPublicServingEnabled } from "../server/display-compact-store-v29.mjs";
import displayCompactIndex from "../server/display-compact-index-v29.json";
import { cleanupV30Request, cleanupV30UploadsEnabled, cleanupV30PublicServingEnabled } from "../server/cleanup-store-v30.mjs";
import cleanupV30Index from "../server/cleanup-index-v30.json";
import { coronaryV36Request, coronaryV36UploadsEnabled, coronaryV36PublicServingEnabled } from "../server/coronary-store-v36.mjs";
import coronaryV36Index from "../server/coronary-index-v36.json";
import { probeHeartV44Request, probeHeartV44UploadsEnabled, probeHeartV44PublicServingEnabled } from "../server/probe-heart-store-v44.mjs";
import probeHeartV44Index from "../server/probe-heart-index-v44.json";

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const bundledJson = await bundledJsonRequest(request, bundledJsonIndex, {
      servePublic: !import.meta.env.DEV,
    });
    if (bundledJson) return bundledJson;
    const probeWholeHeart = await probeHeartV44Request(request, env.BUCKET, probeHeartV44Index, {
      uploadsEnabled: probeHeartV44UploadsEnabled,
      uploadToken: (env as unknown as Record<string, string | undefined>).HEART_PROBE_HEART_UPLOAD_TOKEN,
      servePublic: probeHeartV44PublicServingEnabled && !import.meta.env.DEV,
    });
    if (probeWholeHeart) return probeWholeHeart;
    const coronaryReconstruction = await coronaryV36Request(request, env.BUCKET, coronaryV36Index, {
      uploadsEnabled: coronaryV36UploadsEnabled,
      uploadToken: (env as unknown as Record<string, string | undefined>).HEART_CORONARY_V36_UPLOAD_TOKEN,
      servePublic: coronaryV36PublicServingEnabled && !import.meta.env.DEV,
    });
    if (coronaryReconstruction) return coronaryReconstruction;
    const reconstructionCleanup = await cleanupV30Request(request, env.BUCKET, cleanupV30Index, {
      uploadsEnabled: cleanupV30UploadsEnabled,
      uploadToken: (env as unknown as Record<string, string | undefined>).HEART_CLEANUP_V30_UPLOAD_TOKEN,
      servePublic: cleanupV30PublicServingEnabled && !import.meta.env.DEV,
    });
    if (reconstructionCleanup) return reconstructionCleanup;
    const compactDisplay = await displayCompactRequest(request, env.BUCKET, displayCompactIndex, {
      uploadsEnabled: displayCompactUploadsEnabled,
      uploadToken: (env as unknown as Record<string, string | undefined>).HEART_COMPACT_DISPLAY_UPLOAD_TOKEN,
      servePublic: displayCompactPublicServingEnabled && !import.meta.env.DEV,
    });
    if (compactDisplay) return compactDisplay;
    const cleanupAlias = cleanupStaticAliasRequest(request, cleanupStaticAliasIndex);
    if (cleanupAlias) return cleanupAlias;
    const fineDetail = await fineDetailRequest(request, env.BUCKET, fineDetailIndex, {
      uploadsEnabled: fineDetailUploadsEnabled,
      uploadToken: (env as unknown as Record<string, string | undefined>).HEART_FINE_DETAIL_UPLOAD_TOKEN,
      servePublic: fineDetailPublicServingEnabled && !import.meta.env.DEV,
    });
    if (fineDetail) return fineDetail;
    const motionCT = await motionCTRequest(request, env.BUCKET, motionCTIndex, {
      uploadsEnabled: motionCTUploadsEnabled,
      uploadToken: (env as unknown as Record<string, string | undefined>).HEART_MOTION_CT_UPLOAD_TOKEN,
      servePublic: !import.meta.env.DEV,
    });
    if (motionCT) return motionCT;
    const guidedNative = await guidedNativeRequest(request, env.BUCKET, {
      uploadsEnabled: guidedNativeUploadsEnabled,
      uploadToken: (env as unknown as Record<string, string | undefined>).HEART_GUIDED_NATIVE_UPLOAD_TOKEN,
    });
    if (guidedNative) return guidedNative;
    const nativeSurface = await nativeSurfaceRequest(request, env.BUCKET, nativeSurfaceIndex, {
      uploadsEnabled: nativeSurfaceUploadsEnabled,
      uploadToken: (env as unknown as Record<string, string | undefined>).HEART_NATIVE_SURFACE_UPLOAD_TOKEN,
      servePublic: !import.meta.env.DEV,
    });
    if (nativeSurface) return nativeSurface;
    const display = await comparisonDisplayRequest(request, env.BUCKET, comparisonDisplayIndex, {
      uploadsEnabled: comparisonDisplayUploadsEnabled,
      servePublic: !import.meta.env.DEV,
    });
    if (display) return display;
    const candidate = comparisonBanks.find(bank=>new URL(request.url).pathname.startsWith(bank.route));
    if(candidate){
      const serve = candidate.kind==='volume' ? fineVolumeRequest : ultraRequest;
      const response=await serve(request,env.BUCKET,candidate.index,candidate);
      if(response)return response;
    }
    const fine = await fineVolumeRequest(request, env.BUCKET, fineVolumeIndex, { uploadsEnabled: false });
    if (fine) return fine;
    const scan = await ultraRequest(request, env.BUCKET, ultraIndex, { uploadsEnabled: false });
    if (scan) return scan;
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
  },
};

export default worker;
