exports.handler = async (event, context) => {
  try {
    const body = JSON.parse(event.body);

    // Only track paid orders
    if (body.financial_status === "paid") {
      // Call Meta Pixel Conversion API
      await fetch("https://graph.facebook.com/v17.0/4321219291479784/events?access_token=EAAN1IerTq3sBPPnbRQ5DBqMD1RK07OnSuWilSIRJ9oo4QOhfVKp1DBcrpZAqYVv8qZCnzwsGN0uHk0BzcmikYLv6t87NzZARYLLZABvF05vfDmd7MxjmRZBFgF8ezWWR3vYSTQkfxTz6TR63SVEbsrJYe9Nl7CrUp8guRlgmY31EjBnYvBhZAw3qc7bvOGDIkWhAZDZD", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: [
            {
              event_name: "Purchase",
              event_time: Math.floor(Date.now() / 1000),
              user_data: {
                em: [ body.email ? body.email : "" ] // hashed email if available
              },
              custom_data: {
                currency: body.currency,
                value: body.total_price
              }
            }
          ]
        })
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "OK" }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
