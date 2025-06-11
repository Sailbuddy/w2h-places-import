import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

async function debugPlaceDetails(placeId, lang = 'de') {
  const apiKey = process.env.GOOGLE_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=name,formatted_address,website,url,types,opening_hours,formatted_phone_number,rating,price_level&language=${lang}&key=${apiKey}`;

  console.log('Request URL:', url);

  try {
    const response = await fetch(url);
    const data = await response.json();

    console.log('API Response Status:', data.status);
    if (data.status !== 'OK') {
      console.error('API Error Message:', data.error_message || 'Keine weitere Info');
    } else {
      console.log('Result:', JSON.stringify(data.result, null, 2));
    }

    return data;
  } catch (error) {
    console.error('Fetch Error:', error);
  }
}

// Beispiel-Place-ID zum Testen (ersetze mit deiner Place ID)
const testPlaceId = 'ChIJPx-enXFre0cR9aITmOoWd5o';

debugPlaceDetails(testPlaceId, 'de');
