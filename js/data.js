let cachedProducts = [];
let lastFetchTime = 0;

/**
 * Fetches products from the API and applies cart state from localStorage.
 * @param {boolean} forceReload - If true, bypasses the cache and fetches fresh data.
 * @returns {Promise<Array>} A promise that resolves to the array of products.
 */
export async function loadProducts(forceReload = false) {
    const now = Date.now();
    // Use cache if data is less than 5 seconds old, unless a reload is forced.
    if (!forceReload && now - lastFetchTime < 5000 && cachedProducts.length > 0) {
        return applyCartState(cachedProducts);
    }

    try {
        const response = await fetch('/api/products');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const productsFromAPI = await response.json();
        
        cachedProducts = productsFromAPI;
        lastFetchTime = now;
        
        return applyCartState(productsFromAPI);

    } catch (error) {
        console.error("Could not fetch products:", error);
        return [];
    }
}

/**
 * Merges the cart state from localStorage into the products list.
 * @param {Array} products - The array of product objects from the API.
 * @returns {Array} The products array with 'inCart' and 'quantity' properties updated.
 */
function applyCartState(products) {
    const storedCart = JSON.parse(localStorage.getItem('goshalaProducts')) || [];
    const cartMap = new Map(storedCart.map(item => [item.id, item]));

    // Return a new array to avoid modifying the cache directly
    return products.map(product => {
        const cartItem = cartMap.get(product.id);
        if (cartItem) {
            return {
                ...product,
                inCart: true,
                quantity: cartItem.quantity
            };
        }
        return {
            ...product,
            inCart: false,
            quantity: 0
        };
    });
}