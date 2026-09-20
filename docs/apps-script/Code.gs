// Verlyn Tech Dashboard: Drive filing bridge (Google Apps Script)
//
// Runs as YOU (the Drive owner), so files are created in your Drive with no OAuth consent screen.
// The push-to-drive Supabase function POSTs { secret, folderId, name, mimeType, description, data(base64) }.
// Anyone without the secret gets "unauthorized". Setup: docs/DRIVE_SETUP.md, "Path B".

function doPost(e) {
  try {
    var expected = PropertiesService.getScriptProperties().getProperty('SECRET');
    var req = JSON.parse(e.postData.contents);

    if (!expected || req.secret !== expected) {
      return reply_({ ok: false, error: 'unauthorized' });
    }

    var folder = DriveApp.getFolderById(req.folderId);
    var blob = Utilities.newBlob(Utilities.base64Decode(req.data), req.mimeType, req.name);
    var file = folder.createFile(blob);
    if (req.description) file.setDescription(req.description);

    return reply_({ ok: true, id: file.getId(), url: file.getUrl() });
  } catch (err) {
    return reply_({ ok: false, error: String(err) });
  }
}

function reply_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
