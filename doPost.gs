function doGet(e) {
  Logger.log("✅ doGet triggered with parameters: " + JSON.stringify(e.parameter));
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const settingSheet = ss.getSheetByName("設定");
    const qaSheet = ss.getSheetByName("質問・回答");

    if (!settingSheet) {
      Logger.log("❌ 設定シートが見つかりません");
      return ContentService.createTextOutput("設定シートが見つかりません").setMimeType(ContentService.MimeType.TEXT);
    }

    const mode = e?.parameter?.mode;
    Logger.log("🔧 Mode: " + mode);

    // LIFF ID取得
    if (mode === "getLiffId") {
      try {
        const liffId = settingSheet.getRange("B12").getValue();
        Logger.log("🔑 LIFF ID取得: " + liffId);
        
        if (!liffId) {
          throw new Error("LIFF IDが設定されていません");
        }
        
        return ContentService.createTextOutput(liffId.toString().trim()).setMimeType(ContentService.MimeType.TEXT);
      } catch (error) {
        Logger.log("❌ LIFF ID取得エラー: " + error.message);
        return ContentService.createTextOutput("LIFF ID取得エラー").setMimeType(ContentService.MimeType.TEXT);
      }
    }

    // ステータスが「未着手・着手中」の件名一覧取得
    if (mode === "getTitles") {
      try {
        if (!qaSheet) {
          throw new Error("質問・回答シートが見つかりません");
        }
        
        const values = qaSheet.getDataRange().getValues();
        const titles = new Set();
        const allowedStatus = ["未着手", "着手中"];

        Logger.log("📊 質問・回答シートの行数: " + values.length);

        for (let i = 1; i < values.length; i++) {
          const title = values[i][6];     // G列（質問件名）
          const status = values[i][13];   // N列（ステータス）
          
          if (title && title.toString().trim() && allowedStatus.includes(status)) {
            titles.add(title.toString().trim());
            Logger.log("📝 件名追加: " + title + " (ステータス: " + status + ")");
          }
        }

        const titleArray = [...titles];
        Logger.log("📋 取得した件名一覧: " + JSON.stringify(titleArray));
        
        return ContentService.createTextOutput(JSON.stringify(titleArray))
          .setMimeType(ContentService.MimeType.JSON);
      } catch (error) {
        Logger.log("❌ 件名取得エラー: " + error.message);
        return ContentService.createTextOutput(JSON.stringify([]))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    // modeが指定されていない場合のみHTMLを返す
    Logger.log("🌐 HTMLファイルを返します");
    return HtmlService.createHtmlOutputFromFile("index")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
      
  } catch (error) {
    Logger.log("❌ doGet全体エラー: " + error.message);
    Logger.log("🪵 スタックトレース: " + error.stack);
    return ContentService.createTextOutput("システムエラーが発生しました").setMimeType(ContentService.MimeType.TEXT);
  }
}

function doPost(e) {
  Logger.log("✅ doPost triggered");
  Logger.log("📨 Raw e object: " + JSON.stringify(e));

  try {
    // eオブジェクトが存在しない場合の処理
    if (!e) {
      Logger.log("❌ eオブジェクトが存在しません");
      return ContentService.createTextOutput("エラー：リクエストオブジェクトが存在しません")
        .setMimeType(ContentService.MimeType.TEXT);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const qaSheet = ss.getSheetByName("質問・回答");
    const settingSheet = ss.getSheetByName("設定");
    const nameSheet = ss.getSheetByName("質問者名リスト");
    const taskSheet = ss.getSheetByName("タスク一覧表");

    // 必要なシートの存在確認
    const missingSheets = [];
    if (!qaSheet) missingSheets.push("質問・回答");
    if (!settingSheet) missingSheets.push("設定");
    if (!nameSheet) missingSheets.push("質問者名リスト");
    if (!taskSheet) missingSheets.push("タスク一覧表");
    
    if (missingSheets.length > 0) {
      throw new Error("必要なシートが見つかりません: " + missingSheets.join(", "));
    }

    // パラメータの取得
    let data = {};
    
    Logger.log("🔍 eオブジェクトの詳細:");
    Logger.log("  - e.parameter: " + JSON.stringify(e.parameter || {}));
    Logger.log("  - e.postData: " + JSON.stringify(e.postData || {}));
    
    if (e.parameter && Object.keys(e.parameter).length > 0) {
      Logger.log("📋 e.parameterからデータを取得");
      data = e.parameter;
    } else if (e.postData && e.postData.contents) {
      Logger.log("📋 e.postData.contentsから解析");
      try {
        if (e.postData.type === 'application/x-www-form-urlencoded') {
          const pairs = e.postData.contents.split('&');
          pairs.forEach(pair => {
            const [key, value] = pair.split('=');
            if (key && value !== undefined) {
              data[decodeURIComponent(key)] = decodeURIComponent(value);
            }
          });
        }
      } catch (parseError) {
        Logger.log("❌ postData解析エラー: " + parseError.message);
      }
    }
    
    Logger.log("📦 最終的な受信データ: " + JSON.stringify(data));

    // 空のリクエストの場合はテストデータを使用
    if (!data || Object.keys(data).length === 0) {
      Logger.log("🧪 テストモード: ダミーデータを使用");
      data = {
        uid: "test_user_" + Utilities.getUuid().substring(0, 8),
        responder: "管理人",
        title: "テスト件名_" + Utilities.formatDate(new Date(), "Asia/Tokyo", "MMddHHmm"),
        question: "これはテスト質問です（自動生成）",
        answer: "これはテスト回答です（自動生成）",
        cause: "これはテスト原因です（自動生成）",
        status: "未着手"
      };
      Logger.log("🧪 テスト用データ: " + JSON.stringify(data));
    }

    const now = new Date();
    const qid = "Q" + Utilities.formatDate(now, "Asia/Tokyo", "yyyyMMddHHmmss");
    const groupId = "G" + Utilities.formatDate(now, "Asia/Tokyo", "yyyyMMddHHmmss");

    // デバッグ情報を設定シートに記録
    try {
      if (data.debugInfo && data.debugInfo.trim()) {
        settingSheet.getRange("B25").setValue(data.debugInfo);
        Logger.log("📝 デバッグ情報を設定シートB25に記録");
      }
    } catch (debugError) {
      Logger.log("⚠️ デバッグ情報記録エラー: " + debugError.message);
    }

    // Googleドライブフォルダー設定の取得（B19セルから）
    let photoFolderId = "";
    try {
      photoFolderId = settingSheet.getRange("B19").getValue();
      if (photoFolderId) {
        const photoFolder = DriveApp.getFolderById(photoFolderId);
        Logger.log("📁 写真フォルダー確認済み: " + photoFolderId);
      }
    } catch (folderError) {
      Logger.log("⚠️ 写真フォルダー設定エラー: " + folderError.message);
    }

    // 必須フィールドのチェック
    const requiredFields = ["responder", "title", "question", "answer", "cause", "status"];
    const missingFields = [];
    
    requiredFields.forEach(field => {
      if (!data[field] || data[field].toString().trim() === "") {
        missingFields.push(field);
      }
    });
    
    if (missingFields.length > 0) {
      Logger.log("❌ 必須フィールド不足: " + missingFields.join(", "));
      if (data.uid && data.uid.includes("test_user_")) {
        Logger.log("🧪 テストモードのため続行");
      } else {
        throw new Error("必須フィールドが不足しています: " + missingFields.join(", "));
      }
    }

    const uid = data.uid || "";
    const responder = data.responder || "";
    Logger.log("🆔 UID: " + uid);
    Logger.log("👥 回答者: " + responder);

    // 質問者名リストでの照合・更新処理
    let roomNumber = "", ownerName = "", ownerEmail = "";
    
    try {
      const nameValues = nameSheet.getDataRange().getValues();
      Logger.log("👤 質問者名リストの行数: " + nameValues.length);
      
      let found = false;
      let targetRow = -1;
      
      // 1. UID完全一致での検索
      if (uid) {
        for (let i = 1; i < nameValues.length; i++) {
          const rowRoom = nameValues[i][0];        // A列: 部屋番号
          const rowOwner = nameValues[i][1];       // B列: 所有者名
          const rowEmail = nameValues[i][2];       // C列: メールアドレス
          const rowUid = nameValues[i][3];         // D列: LINEユーザーID

          if (rowUid && rowUid.toString() === uid) {
            roomNumber = rowRoom ? rowRoom.toString() : "";
            ownerName = rowOwner ? rowOwner.toString() : "";
            ownerEmail = rowEmail ? rowEmail.toString() : "";
            targetRow = i + 1;
            found = true;
            Logger.log("🔗 UID完全一致: row " + targetRow + ", 部屋番号: " + roomNumber);
            break;
          }
        }
      }
      
      // 2. UIDが見つからない場合、空のUIDセルにUIDを登録
      if (!found && uid) {
        for (let i = 1; i < nameValues.length; i++) {
          const rowRoom = nameValues[i][0];        // A列: 部屋番号
          const rowOwner = nameValues[i][1];       // B列: 所有者名
          const rowEmail = nameValues[i][2];       // C列: メールアドレス
          const rowUid = nameValues[i][3];         // D列: LINEユーザーID

          if ((!rowUid || rowUid.toString().trim() === "") && rowRoom) {
            // UIDを登録
            nameSheet.getRange(i + 1, 4).setValue(uid);
            
            roomNumber = rowRoom.toString();
            ownerName = rowOwner ? rowOwner.toString() : "";
            ownerEmail = rowEmail ? rowEmail.toString() : "";
            targetRow = i + 1;
            found = true;
            Logger.log("🔗 部屋番号一致でUID登録: row " + targetRow + ", 部屋番号: " + roomNumber);
            break;
          }
        }
      }
      
      // 3. グループ情報の更新（新規グループの場合）
      if (found && targetRow > 0) {
        const currentGroupName = nameSheet.getRange(targetRow, 5).getValue(); // E列: グループ名
        const currentGroupId = nameSheet.getRange(targetRow, 6).getValue();   // F列: グループID
        
        // 新規グループの場合、グループ情報を更新
        if (!currentGroupName || !currentGroupId) {
          nameSheet.getRange(targetRow, 5).setValue(responder);  // E列: グループ名
          nameSheet.getRange(targetRow, 6).setValue(groupId);    // F列: グループID
          Logger.log("📝 新規グループ情報を登録: " + responder + " (" + groupId + ")");
        } else {
          Logger.log("📝 既存グループ情報を使用: " + currentGroupName + " (" + currentGroupId + ")");
        }
      }
      
      if (!found) {
        Logger.log("⚠️ 対応する質問者情報が見つかりませんでした");
      }
      
    } catch (nameError) {
      Logger.log("❌ 質問者名リスト処理エラー: " + nameError.message);
    }

    // 質問・回答シートへの挿入データ準備（新しい列構造に対応）
    let questionPhotoUrl = "";
    let answerPhotoUrl = "";
    
    // 写真URLの処理（将来的にファイルアップロードに対応）
    if (photoFolderId) {
      // 現在は空のまま、将来的にファイルアップロード機能で使用
      questionPhotoUrl = "";
      answerPhotoUrl = "";
    }

    const newRow = [
      qid,                                                           // A列: 問ID
      Utilities.formatDate(now, "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss"), // B列: 質問日時
      uid,                                                           // C列: LINE UID
      roomNumber,                                                    // D列: 部屋番号
      ownerName,                                                     // E列: 質問者名
      responder,                                                     // F列: 回答者選択
      data.title.toString().trim(),                                  // G列: 質問件名
      data.question.toString().trim(),                               // H列: 質問内容
      questionPhotoUrl,                                              // I列: 写真（質問）
      Utilities.formatDate(now, "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss"), // J列: 最終回答日時
      data.answer.toString().trim(),                                 // K列: 回答
      data.cause.toString().trim(),                                  // L列: 原因
      answerPhotoUrl,                                                // M列: 写真（回答）
      data.status.toString().trim(),                                 // N列: ステータス
      responder,                                                     // O列: 回答者名
      ownerEmail,                                                    // P列: 質問者メール
      ""                                                             // Q列: 回答者メール（空欄）
    ];

    // 同じ件名のグループに挿入する位置を決定
    const title = data.title.toString().trim();
    const sheetValues = qaSheet.getDataRange().getValues();
    let insertIndex = sheetValues.length + 1; // デフォルトは最後
    
    // 同じ件名の最後の行を探す
    for (let i = sheetValues.length - 1; i >= 1; i--) {
      if (sheetValues[i][6] && sheetValues[i][6].toString().trim() === title) {
        insertIndex = i + 2; // その次の行に挿入
        break;
      }
    }

    // 行を挿入してデータを設定
    qaSheet.insertRows(insertIndex, 1);
    qaSheet.getRange(insertIndex, 1, 1, newRow.length).setValues([newRow]);
    Logger.log("📋 質問・回答シートに挿入完了: row " + insertIndex);

    // タスク一覧表への記録
    try {
      const taskRow = [
        qid,                                                           // A列: 問ID
        Utilities.formatDate(now, "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss"), // B列: 登録日時
        data.title.toString().trim(),                                  // C列: 件名
        data.question.toString().trim(),                               // D列: 質問内容
        data.status.toString().trim(),                                 // E列: ステータス
        uid,                                                           // F列: UID
        roomNumber,                                                    // G列: 部屋番号
        ownerName,                                                     // H列: 所有者名
        responder,                                                     // I列: 回答者名
        questionPhotoUrl                                               // J列: 写真URL
      ];
      
      taskSheet.appendRow(taskRow);
      Logger.log("📋 タスク一覧表に記録完了");
    } catch (taskError) {
      Logger.log("❌ タスク一覧表記録エラー: " + taskError.message);
    }

    // 成功レスポンス
    const successMessage = "記録完了：" + qid;
    Logger.log("✅ 処理完了: " + successMessage);
    
    return ContentService.createTextOutput(successMessage)
      .setMimeType(ContentService.MimeType.TEXT);

  } catch (err) {
    Logger.log("❌ doPost Error: " + err.message);
    Logger.log("🪵 Stack Trace: " + err.stack);
    
    const errorMessage = "エラー：" + err.message;
    return ContentService.createTextOutput(errorMessage)
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

// 補助関数: データの整合性チェック
function validateSheetStructure() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = ["設定", "質問・回答", "質問者名リスト", "タスク一覧表"];
    
    sheets.forEach(sheetName => {
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        throw new Error(`シート「${sheetName}」が見つかりません`);
      }
      Logger.log(`✅ シート確認完了: ${sheetName}`);
    });
    
    // 設定シートの重要セルチェック
    const settingSheet = ss.getSheetByName("設定");
    const liffId = settingSheet.getRange("B12").getValue();
    
    Logger.log(`🔑 LIFF ID: ${liffId}`);
    
    // 質問者名リストの構造確認
    const nameSheet = ss.getSheetByName("質問者名リスト");
    const nameHeaders = nameSheet.getRange(1, 1, 1, 6).getValues()[0];
    Logger.log(`📋 質問者名リスト列構造: ${nameHeaders}`);
    
    // 質問・回答シートの構造確認
    const qaSheet = ss.getSheetByName("質問・回答");
    const qaHeaders = qaSheet.getRange(1, 1, 1, 17).getValues()[0];
    Logger.log(`📋 質問・回答シート列構造: ${qaHeaders}`);
    
    return "全てのシート構造が正常です";
    
  } catch (error) {
    Logger.log("❌ シート構造エラー: " + error.message);
    return "エラー: " + error.message;
  }
}

// 直接実行可能なテスト関数
function directTest() {
  Logger.log("🧪 直接テスト開始");
  
  const mockE = {
    parameter: {
      uid: "test_user_direct_" + Date.now(),
      responder: "管理人",
      title: "直接テスト件名",
      question: "直接テストの質問です",
      answer: "直接テストの回答です",
      cause: "直接テストの原因です",
      status: "未着手"
    }
  };
  
  try {
    const result = doPost(mockE);
    Logger.log("✅ 直接テスト成功: " + result.getContent());
    return result.getContent();
  } catch (error) {
    Logger.log("❌ 直接テストエラー: " + error.message);
    return "エラー: " + error.message;
  }
}

// シート初期化関数（初回セットアップ用）
function initializeSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 質問者名リストの初期化
  const nameSheet = ss.getSheetByName("質問者名リスト");
  if (nameSheet) {
    const headers = ["部屋番号", "所有者名", "メールアドレス", "LINEユーザーID", "グループ名", "グループID"];
    nameSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    Logger.log("✅ 質問者名リストのヘッダーを設定");
  }
  
  // 質問・回答シートの初期化
  const qaSheet = ss.getSheetByName("質問・回答");
  if (qaSheet) {
    const headers = [
      "問ID", "質問日時", "LINE UID", "部屋番号", "質問者名", "回答者選択",
      "質問件名", "質問内容", "写真", "最終回答日時", "回答", "原因",
      "写真", "ステータス", "回答者名", "質問者メール", "回答者メール"
    ];
    qaSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    Logger.log("✅ 質問・回答シートのヘッダーを設定");
  }
  
  return "シート初期化完了";
}

// 設定値読み込み関数
function getSettingValue(key) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const settingSheet = ss.getSheetByName("設定");
    
    if (!settingSheet) {
      throw new Error("設定シートが見つかりません");
    }
    
    const data = settingSheet.getDataRange().getValues();
    
    for (let i = 0; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString() === key) {
        return data[i][1];
      }
    }
    
    throw new Error(`設定値「${key}」が見つかりません`);
    
  } catch (error) {
    Logger.log(`❌ 設定値取得エラー: ${error.message}`);
    return null;
  }
}
