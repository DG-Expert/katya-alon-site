# CI/CD לסדנה — הפעלה, אישור ופרסום בטוח

## מה הוטמע ומה עדיין לא קורה

השינויים ב-Google Sheets נכתבים רק ל-`content/workshop.yaml` בענף הקבוע `sheet-workshop-drafts`. כל דחיפה לענף מפעילה CI, אך **אינה מפרסמת אתר, Worker או GAS**. בקשת ה-Pull Request ל-`main` נוצרת מחוץ למנגנון הזה; דחיפות Sheet נוספות לאותו ענף יעדכנו אותה אוטומטית.

הזרימה המחייבת היא:

`Google Sheets → sheet-workshop-drafts → CI → סקירת PR ואישור ידני → מיזוג ל-main → אישור production (אם הוגדר) → Worker → Pages`

רק מיזוג ל-`main` או הפעלה ידנית של workflow מהענף `main` יכולים להפעיל פריסה. PR אינו מקבל סודות ואינו פורס דבר.

## מה CI בודק

ה-workflow `.github/workflows/workshop-ci.yml` רץ על דחיפות לענף הטיוטה, על PR שמכוון ל-`main`, ובהפעלה ידנית. הוא:

1. משווה ל-`main` את כל הגדרות ההרשמה המוגנות: endpoint, timeout, Turnstile, consent והדגל `enabled`.
2. חוסם שינוי `event.workshop_id` ביחס ל-`main` (ראו מעבר מזהה בהמשך).
3. בודק את מבנה ה-YAML שנפגע בעבר בעדכון inline מהגיליון ואת ההתאמה ל-`worker/wrangler.toml`.
4. מייצר באופן זמני את `worker/src/event.generated.js` מ-`content/workshop.yaml`, ורק אז מריץ `sync --check` ואת כל בדיקות Node 24.
5. מריץ בדיקות תחביר ו-`git diff --check`.

הקובץ generated אינו נכתב חזרה לענף על ידי Actions, ואין auto-commit עם `GITHUB_TOKEN`. לכן שינוי עתידי של תאריך/שעות ייבדק מול הקובץ שנוצר באותו runner, ולא מול עותק ישן בענף.

## הכנה חד-פעמית לפני המיזוג הראשון

### GitHub Environment ו-Cloudflare

ב-GitHub: `Settings → Environments → New environment → production`.

- הוסיפו ל-environment רק את `CLOUDFLARE_API_TOKEN` ואת `CLOUDFLARE_ACCOUNT_ID`.
- מומלץ להגדיר Required reviewer כדי שכל פריסת production תמתין לאישור. אם לא מוגדר reviewer, ה-gate עדיין קיים אך ממשיך אוטומטית כשהסודות קיימים.
- הסודות `GAS_URL`, `GAS_HMAC_SECRET`, `TURNSTILE_SECRET` כבר מנוהלים ב-Cloudflare. **אין להעתיק אותם ל-GitHub**; ה-workflow אינו קורא או משנה אותם.
- אם אחד משני סודות הפריסה חסר, הפריסה נכשלת לפני Wrangler.

### GitHub Pages — חובה לפני המיזוג

ב-GitHub: `Settings → Pages → Build and deployment → Source`, בחרו **GitHub Actions**. יש לבצע זאת **לפני מיזוג ל-main**. אם המקור נשאר branch-based, Pages עלול להתפרסם במסלול עצמאי מה-Worker וליצור מרוץ בין שתי גרסאות.

הפריסה מעלה ל-Pages רק את `index.html`, `workshops.html`, והתיקיות `css/`, `js/`, `assets/`, `content/`. קוד `gas/`, קוד `worker/`, מסמכים וקבצי repository אינם נכללים בארטיפקט.

### GAS — צעד ידני שאינו חלק מ-GitHub Actions

השינוי הדינמי לאירוע נשמר ב-`Code.gs` החי, אך ה-Web App **עדיין לא קיבל גרסת deployment חדשה**. שמירת הקוד בעורך אינה מעדכנת את ה-URL הפעיל.

לפני המיזוג שמפעיל Worker עם payload האירוע החדש:

1. בדקו את `gas/Code.gs` ואת ה-patch שנוצר ב-`node scripts/make-gas-patch.mjs`.
2. ב-Apps Script פתחו `Deploy → Manage deployments → Edit`.
3. בחרו `New version`, פרסו, וודאו שה-URL הפעיל נשאר אותו URL.
4. בצעו בדיקה מבוקרת רק באישור בעלת המערכת. ה-workflow עצמו אינו שולח הרשמת ניסיון.

כל שינוי עתידי ב-GAS מחייב גרסת Web App חדשה באופן ידני. סדר הבטיחות הוא GAS תחילה, אחר כך מיזוג שמפרסם Worker, ולבסוף Pages.

## פריסה אחרי מיזוג

`.github/workflows/release.yml` רץ בסדר קשיח וללא ביטול ריצה קודמת:

1. מאמת שה-ref הוא `main`, מייצר metadata ובודק את הקוד ב-checkout נקי.
2. נכנס ל-environment `production`, בודק קיום credentials ומפרסם את ה-Worker באמצעות `cloudflare/wrangler-action@v4` מתוך `worker/`.
3. מבצע בקשת `OPTIONS` בלבד ל-endpoint ובודק CORS. אין POST ואין הרשמה אמיתית.
4. רק אחרי הצלחת ה-Worker, בונה ארטיפקט סטטי מצומצם ומפרסם ל-GitHub Pages.
5. קורא את `workshops.html` מכתובת Pages ומוודא תגובה תקינה.

כל כשל עוצר את השלבים שאחריו. בפרט, כשל Worker או smoke check מונע פריסת Pages.

## שינוי `workshop_id` ללא השבתה

ה-Worker הנוכחי מקבל מזהה יחיד ומצרף metadata יחיד חתום. פריסת Worker עם מזהה חדש לפני Pages תגרום לדפים ישנים לקבל `422`; פריסת Pages קודם תגרום לבעיה ההפוכה. לכן CI חוסם שינוי מזהה ביחס ל-`main`.

אין לעקוף את הבדיקה בתוך PR תוכן רגיל. מעבר מזהה דורש PR ייעודי ומתוכנן שמוסיף ל-Worker תמיכה זמנית במזהה הקודם **וב-metadata המקורי שלו**, מכין את רשומת האירוע ב-GAS, פורס GAS תחילה, ורק אז מבצע מעבר מדורג. לאחר חלון המעבר אפשר להסיר את התמיכה הישנה ב-PR נוסף.

## Checklist לסקירה ומיזוג

- כל בדיקות `Workshop CI` ירוקות, וה-diff הצפוי מה-Sheet אינו כולל הגדרות הרשמה מוגנות.
- `layout`, שלוש השפות, תאריכי האירוע, שעות, מחירים וקבצי תמונה נבדקו בעין.
- ההערה בראש ה-YAML עדיין מצביעה על סתירה של **8.11 לעומת 10.11.2026** למועד early bird. בעלת התוכן חייבת להכריע לפני פרסום; CI אינו יכול לבחור נוסח עסקי.
- `workshop_id` לא השתנה. אם הוא צריך להשתנות, עוצרים ועוברים לתהליך המדורג לעיל.
- Pages Source כבר הוחלף ל-GitHub Actions.
- ה-environment `production` ושני סודות Cloudflare הוגדרו; reviewer אישר אם נדרש.
- גרסת GAS חדשה פורסמה ידנית כאשר שינויי GAS ממתינים (כרגע ה-event append שמור אך לא deployed).
- רק לאחר כל אלה מאשרים וממזגים את ה-PR. אין למזג ישירות ללא review.

## חזרה לאחור

- לפני מיזוג: מתקנים בדחיפת Sheet נוספת לאותו ענף, או סוגרים את ה-PR. production לא השתנה.
- אחרי מיזוג: יוצרים `Revert` כ-PR, בודקים וממזגים. המיזוג מפרסם מחדש Worker ולאחריו Pages מהמצב הקודם.
- אם Worker נכשל אחרי פריסה ולפני Pages: משתמשים מיד ב-Cloudflare Rollback לגרסה הקודמת או ממזגים revert מאושר; לא מפעילים רישום אמיתי לצורך בדיקה.
- GAS: ב-Apps Script חוזרים ל-deployment version הקודמת. פעולה זו ידנית ונפרדת מ-GitHub.
- אם credential נחשף: מבטלים אותו אצל הספק, מחליפים את secret ב-environment, ובודקים לוגים בלי להעתיק ערכים למסמכים או ל-PR.
