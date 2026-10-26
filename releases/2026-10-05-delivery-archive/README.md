# 8415Wallet delivery archive inventory

## Public installation availability — 2026-10-25

Public installation downloads are limited to **V2** through [Wallet-Exchange](https://github.com/GiraffeTechnology/Wallet-Exchange/releases). Only an explicitly published V2 installation asset constitutes an available download; if none is listed, no public installation package is currently available. **V3 installation packages are not offered for public download** and are distributed separately through private channels. V3 source descriptions, development reports and historical package records are not public V3 release announcements. This availability policy does not establish production readiness or replace applicable acceptance requirements.

This directory preserves metadata for the historical and candidate archives listed below. The archived ZIP files are not present in the current branch. Filenames and hashes are provenance records, not active download offers. Follow the [current installation-asset publication policy](../../docs/INSTALLATION-ASSET-PUBLICATION.md).

## Historical identity and verification

`manifest.json` and `SHA256SUMS` describe the historical distributed bytes. They may be used to verify an already authorized copy with its original repository-relative layout; they do not provide or authorize new downloads. Reconstructed full ZIPs have separate hashes in the manifest and are not additional downloads.

The manifest distinguishes the original archive identity from the distributed GitHub-safe bytes. The two hashes must not be interchanged. Application source identity remains separate from the commit that publishes these archives.

## Archive versions

- `8415wallet-UI-Beta-CANDIDATE-bc203c72.zip`: candidate
- `8415wallet-V2-V3-DApp-Beta-Handoff-1f4a9ae6-20261004.zip`: historical
- `8415wallet-v3-beta-review.zip`: historical
- `Xiongan-DApp-Branch-Sync-Recovery-8c786de7-20261003.zip`: historical
- `Xiongan-Wallet-Checksum-Repair-Recovery-93934f9-20261003.zip`: historical
- `Xiongan-Wallet-SIN-Handoff-763b0067.zip`: historical

## Interpretation

Candidate and historical labels describe archive status only. This archive publication does not establish a release, deployment, current-head CI result or genuine-device acceptance, and it makes no application changes.

GitHub-safe copies include their applicable publication and omission notices. For their extracted contents, follow the current-copy checksum instructions included in each archive. References marked `HISTORICAL-REFERENCE` preserve provenance and are not current-copy verification commands.

The historical October 4 Wallet ZIP was recorded at its original path without a duplicate mirror; it is no longer present in the current branch. Its SHA-256 is `df5058bec9d5c12cffb9ca10cd7ea991e46696207a50f3d2ccf47ac375681838`, its source commit is `1f4a9ae6dd5b8b062ab4f903920cf4b39d158e36`, and its first publication commit is `909a2b39590467da326ac7e120e431319f75f8f9`. Verify it using the checksum file in that original directory.

The UI candidate has source commit `bc203c7225e5e8898cdff3303981c9ef63b8f931`; preserving it here does not change its candidate status.
