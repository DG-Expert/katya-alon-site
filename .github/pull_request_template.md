## מה השתנה

<!-- תארו בקצרה את שינויי הסדנה. אין להדביק סודות או נתוני נרשמים. -->

## בדיקת תוכן ובטיחות

- [ ] ה-diff נבדק; הגדרות `registration` המוגנות לא השתנו.
- [ ] `workshop_id` לא השתנה. אם כן, ה-PR נעצר ונפתח תהליך מעבר מדורג.
- [ ] עברית, English ו-Русский נבדקו, כולל layout, תאריכים, שעות, מחירים ותמונות.
- [ ] `Workshop CI` עבר במלואו.

## מוכנות לפריסה — לפני Merge בלבד

- [ ] GitHub Pages Source מוגדר ל-**GitHub Actions**.
- [ ] Environment בשם `production` כולל `CLOUDFLARE_API_TOKEN` ו-`CLOUDFLARE_ACCOUNT_ID` בלבד; אין בו סודות runtime של Worker.
- [ ] אם שינוי GAS ממתין: פורסמה ידנית **New version** של ה-Web App. ה-event append השמור ב-`Code.gs` אינו פעיל עד אז.
- [ ] reviewer אנושי אישר את ה-diff ואת מוכנות הפריסה.

מיזוג ל-`main` מפעיל production: Worker נפרס ונבדק תחילה, ורק לאחר הצלחה נפרס Pages. אין למזג כדי "לנסות".
