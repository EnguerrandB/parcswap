# Insufficient Funds Error Fix

## Problem

Users were experiencing two cascading errors when trying to book paid parking spots without sufficient wallet balance:

1. **Error 1**: `POST https://us-central1-parkswap-36bb2.cloudfunctions.net/bookSpotSecure 400 (Bad Request)`
   - Error: `insufficient_funds`
2. **Error 2**: `Error marking nav started on spot Error: spot_not_booked`
   - This occurred because the booking failed, so the spot remained in 'available' status
   - When the user tried to navigate, the system expected the spot to be 'booked'

## Root Cause

The booking flow didn't validate wallet balance on the client-side before attempting to book. This led to:

- Poor user experience (cryptic error messages)
- Confusing error cascade (booking fails → navigation fails)
- No clear guidance on how to resolve the issue

## Solution Implemented

### 1. Pre-Booking Wallet Validation

Added client-side validation in `handleBookSpot()` to check wallet balance BEFORE calling the cloud function:

```javascript
// Pre-validate wallet balance for paid spots
const spotPriceCents = safePrice(spot?.price) * 100;
const isFreeSpot = spotPriceCents <= 0;
if (!isFreeSpot) {
  const availableCents = user?.walletCents ?? 0;
  if (availableCents < spotPriceCents) {
    // Show modal and return early
    setInsufficientFundsModal({...});
    return { ok: false, code: 'insufficient_funds' };
  }
}
```

### 2. User-Friendly Error Modal

Created a new modal (`insufficientFundsModal`) that displays:

- Clear error message: "Recharge ton portefeuille"
- Required amount vs. available amount comparison
- Two action buttons:
  - "Annuler" (Cancel) - dismisses the modal
  - "Recharger" (Top-up) - navigates to profile/wallet section

### 3. Fallback Error Handling

Added catch-all error handling for cases where the cloud function still returns `insufficient_funds`:

```javascript
if (rawCode === 'insufficient_funds') {
  // Calculate and show the modal
  setInsufficientFundsModal({...});
}
```

## Benefits

✅ **Better UX**: Users see a clear, actionable error message immediately
✅ **Prevents Cascade**: Booking attempt is blocked before it can fail
✅ **Guided Resolution**: Direct link to wallet top-up functionality
✅ **Bilingual Support**: Uses i18n for French/English translations
✅ **Consistent Design**: Modal matches the app's existing design system

## Testing Checklist

- [ ] Try to book a paid spot with insufficient funds
- [ ] Verify the modal appears with correct amounts
- [ ] Click "Annuler" to dismiss
- [ ] Click "Recharger" to navigate to profile
- [ ] Verify no console errors appear
- [ ] Test with both free and paid spots
- [ ] Test with exactly matching balance
- [ ] Test in both light and dark themes

## Files Modified

- `parkswap/src/App.jsx`
  - Added `insufficientFundsModal` state
  - Added pre-booking validation in `handleBookSpot()`
  - Added fallback error handling for cloud function errors
  - Added insufficient funds modal UI component

## Related Code

The cloud function validation remains unchanged (as it should for security):

- `parkswap/functions/index.js` - `bookSpotSecure` function
  - Line ~180: Server-side wallet validation
  - Throws `insufficient_funds` error if balance is too low
