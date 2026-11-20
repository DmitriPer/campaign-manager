# הגדרת כניסה עם Google

הוראות חד־פעמיות לחיבור Google ל־Supabase. הקוד באפליקציה כבר מוכן (T02a). בלי ההגדרה הזו, לחיצה על "התחברות עם Google" מחזירה `provider is not enabled`.

שלושה מקומות צריכים להכיר זה את זה: Google, ‏Supabase והאפליקציה. ‏Google מחזיר את המשתמש ל־**Supabase**, ו־Supabase מחזיר אותו ל־**אפליקציה**. אלה שתי כתובות שונות, בשני מקומות שונים.

## 1. ‏Google Cloud Console

1. פתח את [Google Cloud Console](https://console.cloud.google.com/) וצור פרויקט חדש, למשל `campaign-manager`.
2. **מסך ההסכמה (OAuth consent screen / Google Auth Platform → Branding):**
   - שם האפליקציה: `Campaign Manager`, ומייל לתמיכה.
   - סוג משתמשים: **External**.
   - במצב **Testing**, הוסף את חשבון ה־Google שלך תחת **Test users**. במצב הזה רק משתמשים ברשימה יכולים להיכנס.
3. **יצירת לקוח (Clients → Create client):**
   - סוג: **Web application**.
   - ב־**Authorized redirect URIs** הוסף בדיוק את הכתובת הבאה, בלי `/` בסוף:
     `https://hdzcymgxefcirabatfmr.supabase.co/auth/v1/callback`
   - שמור. תקבל **Client ID** ו־**Client Secret**.

את ה־Client Secret **לא שולחים בצ'אט ולא שומרים בקוד**. הוא נכנס רק ל־Supabase.

## 2. ‏Supabase

1. **Authentication → Sign In / Providers → Google:** הפעל, והדבק את ה־Client ID וה־Client Secret. שמור.
2. **Authentication → URL Configuration:**
   - **Site URL:** ‏`http://localhost:4200` לבינתיים. נחליף בכתובת Vercel ב־T09.
   - **Redirect URLs:** הוסף `http://localhost:4200/**`.

אם כתובת חזרה לא נמצאת ברשימה, Supabase מחזיר בשקט ל־Site URL. זו הסיבה הנפוצה ל"זה לא עובד".

אל תריץ `supabase config push` על הפרויקט בענן. הוא דורס את הגדרות ה־Auth שם עם הקובץ המקומי.

## 3. בדיקה

1. ‏`npm start`, ואז לפתוח את http://localhost:4200.
2. ללחוץ "התחברות עם Google" ולבחור את החשבון שהוספת כ־Test user.
3. אחרי החזרה, אמור להופיע בכותרת השם שלך מ־Google, ובדף הבית "שלום, ‏&lt;השם&gt;".

### שגיאות נפוצות

| שגיאה | הסיבה |
| --- | --- |
| ‏`redirect_uri_mismatch` (בדף של Google) | הכתובת ב־Authorized redirect URIs לא זהה לגמרי, אפילו בגלל `/` בסוף. |
| ‏`access_denied` או "app has not completed verification" | החשבון לא נמצא ברשימת Test users. |
| ‏`provider is not enabled` | ‏Google לא הופעל ב־Supabase, או שלא נשמר. |
| חוזרים לכתובת הלא נכונה | ‏`http://localhost:4200/**` חסר ב־Redirect URLs. |
| ‏"Database error saving new user" | תקלה בטריגר שיוצר פרופיל. לבדוק את המיגרציה `20261120090000_profiles.sql`. |
